import { UPDATE_EVENT_SQL } from './eventRevision'
import type { AppPreferences, AgentTask, AgentEvent, AgentSessionState, SetupOmission } from '@ramu/shared/types'
import { questionState } from '@ramu/shared/chat/questions'
import { helperRecoverySources, type HelperHistoryLoader } from './helperHistory'
import { latestTasks } from '@ramu/shared/chat/agentTasks'
import { WRITING_STATES } from './constants'
import { errorMessage } from './util'
import { transcriptOf, conversationHandoff } from './handoff'
import type { MessageDispatcher } from './messageDispatcher'
import type { SessionRecorder } from './sessionRecorder'
import type { SessionRegistry } from './sessionRegistry'
import type { UserRequests } from './userRequests'
import type { SessionStarter } from './sessionStarter'
import type { SessionStore } from './sessionStore'
import type { AgentTasks } from './agentTasks'
import type { AgentService } from '../agent'
import type { Db } from '../db'

/** What RestartRecovery needs from the rest of the service. */
export interface RestartRecoveryHost
  extends
    Pick<MessageDispatcher, 'updateQueue' | 'workspaceBusy'>,
    Pick<SessionRecorder, 'record' | 'setState'>,
    Pick<SessionRegistry, 'live' | 'runners'>,
    Pick<UserRequests, 'questionStatus'>,
    Pick<SessionStarter, 'send'>,
    Pick<SessionStore, 'emit' | 'events' | 'get' | 'hasRunningTasks' | 'isRecoveryPending' | 'queuePaused' | 'queued'>,
    Pick<AgentTasks, 'settleTasks' | 'updateTask'> {
  helperHistory(): AgentService['helperHistory']
  preferences(): AppPreferences | undefined
  sessionCheckpoint(): AgentService['sessionCheckpoint']
  setupOmissions(): AgentService['setupOmissions']
  shutdown(): AgentService['shutdown']
}

/** What happens to unfinished chats across an app restart: marking them restored, reloading helper output and resuming them. */
export class RestartRecovery {
  constructor(
    private readonly host: RestartRecoveryHost,
    private readonly db: Db,
  ) {}

  private recoveringChats = false

  private readonly helperRecoveryPending = new Set<string>()

  private helperRecovery: Promise<void> | null = null

  /** After a restart no SDK process survives: anything not terminal becomes "restored" (transcript only). */
  markRestoredOnBoot(): void {
    // Older shutdown code stopped every attached process, including idle ones. A successful final result with
    // only queue/state bookkeeping after it is a completed turn, not evidence of an interruption. Any later
    // user message, helper update, request, error or tool activity keeps the stopped outcome intact.
    const completed = this.db
      .prepare(
        `SELECT s.id FROM agent_sessions s WHERE s.state = 'stopped'
      AND (SELECT json_extract(e.event, '$.kind') FROM agent_events e WHERE e.session_id = s.id
        AND json_extract(e.event, '$.kind') NOT IN ('state','queue') ORDER BY e.seq DESC LIMIT 1) = 'result'
      AND (SELECT json_extract(e.event, '$.isError') FROM agent_events e WHERE e.session_id = s.id
        AND json_extract(e.event, '$.kind') NOT IN ('state','queue') ORDER BY e.seq DESC LIMIT 1) = 0`,
      )
      .all() as { id: string }[]
    for (const { id } of completed) {
      this.db.prepare("UPDATE agent_sessions SET state = 'restored' WHERE id = ? AND state = 'stopped'").run(id)
      this.host.record(id, { kind: 'state', state: 'restored' })
    }
    this.prepareForRestart()
    this.db
      .prepare(`UPDATE agent_sessions SET state = 'restored' WHERE state NOT IN ('stopped', 'failed', 'restored')`)
      .run()
    this.db
      .prepare("UPDATE agent_sessions SET state = 'restored' WHERE id IN (SELECT session_id FROM agent_recovery)")
      .run()
    this.db.prepare("UPDATE tasks SET status = 'idle' WHERE status IN ('running', 'needs-input')").run()
    const sessions = this.db.prepare('SELECT id FROM agent_sessions').all() as { id: string }[]
    for (const { id } of sessions)
      if (
        !this.host.get(id).parentId &&
        (this.host.get(id).providerSessionId || this.host.events(id).some((event) => event.kind === 'init')) &&
        this.host.events(id).some((event) => event.kind === 'agent')
      )
        this.helperRecoveryPending.add(id)
    for (const { id } of sessions)
      for (const event of this.host.events(id)) {
        // A secret card's waiter lived in the old process; nobody can receive an answer now.
        if (event.kind === 'elicitation' || event.kind === 'secret-request') {
          if (!questionState(this.host.events(id), event.requestId).outcome)
            this.host.record(id, { kind: 'request-resolved', requestId: event.requestId, outcome: 'cancelled' })
          continue
        }
        if (event.kind !== 'question') continue
        const state = this.host.questionStatus(id, event.requestId)
        if (state.outcome) continue
        if (event.responseMode === 'message' && state.waiting)
          this.host.record(id, { kind: 'question-state', requestId: event.requestId, waiting: false })
        else if (event.responseMode !== 'message')
          this.host.record(id, { kind: 'request-resolved', requestId: event.requestId, outcome: 'cancelled' })
      }
  }

  /** Capture only unfinished root chats, including a finished main turn with helpers still working. */
  prepareForRestart(): void {
    const roots = this.db
      .prepare(
        "SELECT id, state FROM agent_sessions WHERE parent_session_id IS NULL AND state NOT IN ('stopped','failed','restored')",
      )
      .all() as { id: string; state: AgentSessionState }[]
    const insert = this.db.prepare('INSERT OR IGNORE INTO agent_recovery VALUES (?, ?)')
    for (const root of roots) {
      if (
        WRITING_STATES.includes(root.state) ||
        this.host.hasRunningTasks(root.id) ||
        this.db
          .prepare(
            "SELECT 1 FROM agent_sessions WHERE parent_session_id = ? AND state IN ('starting','running','needs-input')",
          )
          .get(root.id)
      )
        insert.run(root.id, Number(this.host.queuePaused(root.id)))
    }
  }

  /** Reload helper output even when automatic continuation is disabled. Failed reads retain local history. */
  restoreHelperTranscripts(): Promise<void> {
    if (this.helperRecovery) return this.helperRecovery
    this.helperRecovery = (async () => {
      for (const id of this.helperRecoveryPending) {
        if (this.host.shutdown()) break
        this.helperRecoveryPending.delete(id)
        const session = this.host.get(id)
        const snapshot = this.host.events(id)
        const tasks = latestTasks(snapshot).filter(
          (task) =>
            !this.db
              .prepare('SELECT 1 FROM agent_sessions WHERE id = ? AND parent_session_id = ?')
              .get(task.agentId, id),
        )
        if (!tasks.length || this.host.live.has(id) || this.host.runners.has(id)) continue
        const history: Awaited<ReturnType<HelperHistoryLoader>> = []
        for (const source of helperRecoverySources(session, snapshot, tasks)) {
          if (this.host.shutdown() || this.host.live.has(id) || this.host.runners.has(id)) break
          try {
            history.push(
              ...(await this.host.helperHistory()(source.session, source.tasks)).map((entry) => ({
                ...entry,
                task: {
                  ...entry.task,
                  provider: source.session.provider,
                  providerSessionId: source.session.providerSessionId!,
                },
              })),
            )
          } catch (error) {
            history.push(
              ...source.tasks.map((task) => ({
                task: {
                  ...task,
                  provider: source.session.provider,
                  providerSessionId: source.session.providerSessionId!,
                },
                events: [],
                error: errorMessage(error),
              })),
            )
          }
        }
        // A manual send/stop/provider switch while reading wins over the old snapshot.
        if (
          this.host.shutdown() ||
          this.host.live.has(id) ||
          this.host.runners.has(id) ||
          this.host.get(id).providerSessionId !== session.providerSessionId ||
          this.host.events(id).length !== snapshot.length
        )
          continue
        for (const { task, events, error } of history) {
          this.mergeHelperHistory(id, task, events)
          this.host.updateTask(id, task.agentId, {
            ...task,
            status: task.status === 'running' ? 'stopped' : task.status,
            recovered: true,
            recoveryError: error ?? '',
            canStop: false,
            canMessage: false,
          })
        }
        // Unsupported providers and background commands still cannot keep a dead process alive.
        this.host.settleTasks(id)
      }
    })().finally(() => {
      this.helperRecovery = null
    })
    return this.helperRecovery
  }

  private mergeHelperHistory(id: string, task: AgentTask, recovered: AgentEvent[]): void {
    const rows = this.db.prepare('SELECT seq, event FROM agent_events WHERE session_id = ? ORDER BY seq').all(id) as {
      seq: number
      event: string
    }[]
    const existing = rows.map((row) => ({ seq: row.seq, event: JSON.parse(row.event) as AgentEvent }))
    const used = new Set<number>()
    for (const event of recovered) {
      if (!event.agentId || !['text', 'tool-use', 'tool-result'].includes(event.kind)) continue
      const match = existing.find(
        ({ seq, event: old }) =>
          !used.has(seq) &&
          (old.agentId === event.agentId || (!!task.toolUseId && old.agentId === task.toolUseId)) &&
          old.kind === event.kind &&
          (event.kind === 'text' && old.kind === 'text'
            ? (event.messageId === old.messageId && !!event.messageId) ||
              (!old.messageId && old.text === event.text) ||
              (!!event.nativeMessageId &&
                event.nativeMessageId === old.nativeMessageId &&
                !!old.messageId?.startsWith('claude-stream:') &&
                event.text.startsWith(old.text))
            : (event.kind === 'tool-use' || event.kind === 'tool-result') &&
              (old.kind === 'tool-use' || old.kind === 'tool-result') &&
              (event.toolUseId === old.toolUseId || event.toolUseId === `${event.agentId}:${old.toolUseId}`)),
      )
      if (!match) {
        this.host.record(id, event)
        continue
      }
      used.add(match.seq)
      // Retain the original timestamp and readable input summary for already-received tool calls.
      const merged =
        event.kind === 'tool-use'
          ? { ...match.event, toolUseId: event.toolUseId, agentId: event.agentId }
          : { ...event, at: match.event.at }
      this.db.prepare(UPDATE_EVENT_SQL).run(JSON.stringify(merged), id, id, match.seq)
      this.host.emit(id, merged, match.seq)
    }
  }

  /** Continue the original session; pending chats sharing a checkout wait for its current writer. */
  async resumeInterruptedChats(): Promise<void> {
    if (this.recoveringChats || this.host.shutdown()) return
    this.recoveringChats = true
    try {
      await this.restoreHelperTranscripts()
      if (this.host.preferences()?.resumeChatsOnRestart === false) {
        this.db.prepare('DELETE FROM agent_recovery').run()
        return
      }
      const rows = this.db
        .prepare('SELECT session_id AS id, queue_paused AS paused FROM agent_recovery ORDER BY rowid')
        .all() as { id: string; paused: number }[]
      for (const { id, paused } of rows) {
        if (this.host.shutdown()) break
        if (!this.host.isRecoveryPending(id)) continue
        const session = this.host.get(id)
        if (this.host.workspaceBusy(session.covers, id)) continue
        try {
          // Old requests belong to dead processes. Let the resumed provider ask again, without carrying approvals.
          const events = this.host.events(id)
          const resolved = new Set(events.filter((e) => e.kind === 'request-resolved').map((e) => e.requestId))
          for (const event of events)
            if (
              (event.kind === 'permission-request' ||
                (event.kind === 'question' && event.responseMode !== 'message')) &&
              !resolved.has(event.requestId)
            )
              this.host.record(id, { kind: 'request-resolved', requestId: event.requestId, outcome: 'cancelled' })
          this.host.settleTasks(id)
          const unfinished = new Set(
            latestTasks(events)
              .filter((task) => task.status === 'running')
              .map((task) => task.agentId),
          )
          const helpers = latestTasks(this.host.events(id))
            .filter((task) => task.recovered || unfinished.has(task.agentId))
            .map((task) => ({
              agentId: task.agentId,
              name: task.name,
              status: task.status,
              prompt: task.prompt,
              progress: task.summary,
              recoveryError: task.recoveryError,
              transcript: transcriptOf(
                this.host
                  .events(id)
                  .filter((event) => event.agentId === task.agentId)
                  .map((event) => {
                    const { agentId: _, ...root } = event
                    return root as AgentEvent
                  }),
              ).slice(-5000),
            }))
          const pendingQuestions = events.flatMap((e) => {
            if (e.kind !== 'question' || e.responseMode !== 'message' || questionState(events, e.requestId).outcome)
              return []
            const { drafts: _drafts, ...state } = this.host.questionStatus(id, e.requestId)
            return [state]
          })
          const instruction = `Ramu restarted while this thread was in progress. Continue the unfinished user request from the conversation. Inspect the current files and tool results before acting; do not repeat completed work or replay commands blindly. Previous processes and blocking input requests are gone. Ask again if an approval or blocking answer is still needed. Async questions below are still pending: reuse their IDs with question_status or wait_for_answer; do not ask duplicates. Reconcile unfinished helpers before starting replacements.\nPending questions: ${JSON.stringify(pendingQuestions).slice(-20000)}\nUnfinished helpers: ${JSON.stringify(helpers).slice(-20000)}`
          const prompt = session.providerSessionId
            ? instruction
            : `${conversationHandoff(events, this.host.sessionCheckpoint()?.(id))}\n\n${instruction}`
          this.host.updateQueue(id, this.host.queued(id), !!paused)
          let setupOmissions: SetupOmission[] = []
          try {
            setupOmissions = this.host.setupOmissions()?.(session, session.settings) ?? []
          } catch {
            // Unreadable Shared MCP configuration is reported in Settings; it must not stop a resume.
          }
          this.host.record(id, {
            kind: 'recovery',
            state: 'resumed',
            ...(setupOmissions.length ? { setupOmissions } : {}),
          })
          await this.host.send(id, prompt, [], undefined, false)
          if (!this.host.isRecoveryPending(id)) continue // Stopped or manually continued during recovery.
          this.db.prepare('DELETE FROM agent_recovery WHERE session_id = ?').run(id)
          // Scheduled work continues the same occurrence, rather than creating or replaying a run.
          this.db
            .prepare(
              "UPDATE schedule_runs SET status = 'running', error = NULL WHERE session_id = ? AND status = 'interrupted'",
            )
            .run(id)
        } catch (error) {
          this.db.prepare('DELETE FROM agent_recovery WHERE session_id = ?').run(id)
          this.host.record(id, {
            kind: 'error',
            message: `Could not continue after restart: ${errorMessage(error)}. Continue this thread manually.`,
          })
          this.host.setState(id, 'failed')
        }
      }
    } finally {
      this.recoveringChats = false
    }
  }
}
