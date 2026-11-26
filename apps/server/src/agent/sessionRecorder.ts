import { INSERT_EVENT_SQL, UPDATE_EVENT_SQL } from './eventRevision'
import { permissionKey, PermissionApprovals, commandPatterns } from './permissionApprovals'
import { goalContinues } from '@ramu/shared/chat/goalHold'
import { commandDeploy } from '@ramu/shared/deployActions'
import { isStaleProgress } from '@ramu/shared/chat/agentTasks'
import { settledLength } from '@ramu/shared/chat/settledText'
import type { AppPreferences, AgentEvent, AgentSessionState, AgentTask } from '@ramu/shared/types'
import type { MessageDispatcher } from './messageDispatcher'
import type { GoalManager } from './goalManager'
import type { SessionRegistry } from './sessionRegistry'
import { PRODUCTION_DEPLOY_NOTE, type UserRequests } from './userRequests'
import type { SessionStore } from './sessionStore'
import type { SubagentRunner } from './subagentRunner'
import type { AgentTasks } from './agentTasks'
import type { FallbackRouter } from './fallbackRouter'
import type { AgentService } from '../agent'
import type { Db } from '../db'

/** A reply's whole words go out at most this often, so a fast stream costs every device a few redraws a second. */
const REPLY_STEP_MS = 400
/** A reply quiet this long mid-word is sent whole. */
const REPLY_IDLE_MS = 800

/** A reply still being written: its whole text so far, what of it went out and when. */
interface HeldReply {
  event: Extract<AgentEvent, { kind: 'text' }>
  replaces?: string
  sent: string
  sentAt: number
  timer?: NodeJS.Timeout
}

/** What SessionRecorder needs from the rest of the service. */
export interface SessionRecorderHost
  extends
    Pick<MessageDispatcher, 'dispatchQueued' | 'dispatchSteering' | 'wakeWorkspaceQueue' | 'workspaceQueue'>,
    Pick<GoalManager, 'getGoal' | 'saveGoal' | 'scheduleGoal'>,
    Pick<SessionRegistry, 'draining' | 'finalizing' | 'live' | 'pendingBackground' | 'runners'>,
    Pick<UserRequests, 'notifyWaiters' | 'applySavedPermission'>,
    Pick<SessionStore, 'emit' | 'events' | 'get' | 'hasRunningTasks' | 'latestEvent' | 'helperSummary' | 'list'>,
    Pick<SubagentRunner, 'children' | 'mirrorChild' | 'settleChild'>,
    Pick<AgentTasks, 'updateTask'>,
    Pick<FallbackRouter, 'applyWaiting'> {
  preferences(): AppPreferences | undefined
  reviewHooks(): AgentService['reviewHooks']
}

/** Persists events and state transitions: appends or updates log entries, tracks running tools, and reacts to a session changing state. */
export class SessionRecorder {
  constructor(
    private readonly host: SessionRecorderHost,
    private readonly db: Db,
  ) {}

  readonly activeTools = new Map<string, Set<string>>()

  /** Timers that move a long foreground command to the background, by session and tool use id. */
  private readonly autoBackground = new Map<string, Map<string, NodeJS.Timeout>>()

  /**
   * Replies still being written, by session and message. A reply goes out whole words at a time, a few times a second,
   * whatever pieces its provider streams, so every client sees it grow without a word changing under the reader.
   */
  private readonly unsettled = new Map<string, Map<string, HeldReply>>()

  record(id: string, recorded: AgentEvent, replacesMessageId?: string): void {
    if (recorded.kind === 'tool-use' || recorded.kind === 'tool-result')
      this.host.reviewHooks()?.observe?.(id, recorded)
    if (recorded.kind === 'text' && recorded.messageId) {
      const held = this.unsettled.get(id) ?? new Map<string, HeldReply>()
      this.unsettled.set(id, held)
      // Another reply from the same agent has begun, so the earlier one is finished.
      for (const [messageId, entry] of held)
        if (
          messageId !== recorded.messageId &&
          messageId !== replacesMessageId &&
          (entry.event.agentId ?? '') === (recorded.agentId ?? '')
        )
          this.releaseText(id, messageId)
      const previous = held.get(recorded.messageId) ?? (replacesMessageId ? held.get(replacesMessageId) : undefined)
      clearTimeout(previous?.timer)
      if (replacesMessageId) held.delete(replacesMessageId)
      held.set(recorded.messageId, {
        event: recorded,
        replaces: replacesMessageId ?? previous?.replaces,
        sent: previous?.sent ?? '',
        sentAt: previous?.sentAt ?? Number.NEGATIVE_INFINITY,
      })
      this.deliverText(id, recorded.messageId, false)
      return
    }
    // Anything else the agent does (a tool, a question, its result) means the reply before it is complete.
    if (recorded.kind !== 'thinking') this.releaseText(id)
    this.persist(id, recorded, replacesMessageId)
    // A settings change held for the provider's own sub-agents and commands goes ahead once the last of them ends.
    if (
      (recorded.kind === 'agent' && recorded.status !== 'running') ||
      (recorded.kind === 'state' && recorded.state !== 'running' && recorded.state !== 'starting')
    )
      queueMicrotask(
        () =>
          void Promise.resolve()
            .then(() => this.host.applyWaiting(id))
            // The service may have closed its database since: a session that has ended has nothing left to apply.
            .catch((error: unknown) => {
              if ((error as { code?: unknown } | null)?.code !== 'ERR_INVALID_STATE') console.error(error)
            }),
      )
  }

  /**
   * Sends a held reply's finished blocks, at most every few hundred milliseconds so a fast stream is not written once
   * per line. The step that comes due runs on a timer rather than waiting for the provider's next piece, and a reply
   * that goes quiet mid-block (the agent thinking before a tool) is sent whole, so what it wrote never looks lost.
   */
  private deliverText(id: string, messageId: string, idle: boolean): void {
    const entry = this.unsettled.get(id)?.get(messageId)
    if (!entry) return
    clearTimeout(entry.timer)
    entry.timer = undefined
    const now = Date.now()
    const ready = idle ? entry.event.text : entry.event.text.slice(0, settledLength(entry.event.text))
    // What already shows never shrinks; a provider that rewrote its text (not a continuation) replaces it.
    const fresh = ready !== '' && !entry.sent.startsWith(ready)
    const waiting = fresh && !idle && now - entry.sentAt < REPLY_STEP_MS
    if (fresh && !waiting) {
      this.persist(id, { ...entry.event, text: ready }, entry.replaces)
      entry.sent = ready
      entry.sentAt = now
    }
    if (entry.sent === entry.event.text) return
    const timer = setTimeout(
      () => {
        if (this.unsettled.get(id)?.get(messageId) === entry) this.deliverText(id, messageId, !waiting)
      },
      waiting ? entry.sentAt + REPLY_STEP_MS - now : REPLY_IDLE_MS,
    )
    timer.unref?.()
    entry.timer = timer
  }

  /** Sends the rest of a reply held back for its block to end: one message, or every reply of the session. */
  private releaseText(id: string, messageId?: string): void {
    const held = this.unsettled.get(id)
    if (!held) return
    for (const [key, entry] of [...held]) {
      if (messageId !== undefined && key !== messageId) continue
      clearTimeout(entry.timer)
      held.delete(key)
      if (entry.event.text !== entry.sent) this.persist(id, entry.event, entry.replaces)
    }
    if (!held.size) this.unsettled.delete(id)
  }

  private persist(id: string, recorded: AgentEvent, replacesMessageId?: string): void {
    const questionRequestId = recorded.kind === 'question' ? recorded.requestId : undefined
    if (
      recorded.kind === 'question' &&
      recorded.responseMode === 'message' &&
      this.host.events(id).some((e) => e.kind === 'question' && e.requestId === questionRequestId)
    )
      return
    if (recorded.kind === 'permission-request') {
      const pending = this.host.live.get(id)?.pending.get(recorded.requestId)
      const command =
        recorded.approvalCommand ??
        (pending?.kind === 'permission' && recorded.toolName === 'Bash' && typeof pending.input.command === 'string'
          ? pending.input.command
          : undefined)
      // A production deploy asks however the provider would have answered: never through a saved rule, at most once
      // per thread, and the reply runs the project's migrations first.
      if (!recorded.productionDeploy && command && commandDeploy(command) === 'production')
        recorded = {
          ...recorded,
          detail: `${recorded.detail}\n${PRODUCTION_DEPLOY_NOTE}`,
          productionDeploy: true,
          approvalOnceOnly: true,
          approvalKey: undefined,
          approvalPatterns: undefined,
        }
      const key = recorded.approvalOnceOnly
        ? undefined
        : (recorded.approvalKey ??
          (pending?.kind === 'permission' ? permissionKey(recorded.toolName, pending.input) : undefined))
      if (key)
        recorded = {
          ...recorded,
          approvalKey: key,
          approvalCommand: command,
          approvalPatterns: [...new Set([...(recorded.approvalPatterns ?? []), ...commandPatterns(command)])],
          approvalSessionId: recorded.approvalSessionId ?? id,
          approvalProvider: recorded.approvalProvider ?? this.host.get(id).provider,
          approvalProjectId:
            recorded.approvalProjectId ?? new PermissionApprovals(this.db).project(this.host.get(id).taskId),
        }
    }
    if (
      recorded.kind === 'permission-request' &&
      recorded.approvalKey &&
      recorded.approvalCommand &&
      recorded.approvalProvider === 'antigravity' &&
      this.host.get(id).settings.access === 'auto'
    ) {
      const approvals = new PermissionApprovals(this.db)
      approvals.ensureAntigravityDefaults()
      const rule = approvals.find(
        'antigravity',
        recorded.approvalKey,
        recorded.approvalProjectId,
        recorded.approvalCommand,
        'auto',
      )
      if (rule?.behavior === 'ask')
        recorded = {
          ...recorded,
          approvalReviewRule: rule.label,
          approvalOnceOnly: true,
          approvalKey: undefined,
          approvalPatterns: undefined,
        }
    }
    const run = this.host.children.get(id)
    if (run) this.host.mirrorChild(id, run, recorded, replacesMessageId)
    if (recorded.agentId && recorded.kind !== 'agent') {
      /* a sub-agent's tools do not hold up steering of the main agent */
    } else if (recorded.kind === 'tool-use') {
      const tools = this.activeTools.get(id) ?? new Set<string>()
      tools.add(recorded.toolUseId)
      this.activeTools.set(id, tools)
      if (recorded.name === 'Bash') this.armAutoBackground(id, recorded.toolUseId)
    } else if (recorded.kind === 'tool-result' && !recorded.running) {
      this.disarmAutoBackground(id, recorded.toolUseId)
      const tools = this.activeTools.get(id)
      tools?.delete(recorded.toolUseId)
      if (!tools?.size) {
        this.activeTools.delete(id)
        queueMicrotask(() => {
          void this.host.dispatchSteering(id)
        })
      }
    }
    const event: AgentEvent = recorded.at ? recorded : { ...recorded, at: Date.now() }
    // Compaction updates retain their first timeline position, including late token readings.
    if (event.kind === 'compaction' && event.compactionId) {
      const previous = this.db
        .prepare(
          "SELECT seq, event FROM agent_events WHERE session_id = ? AND json_extract(event, '$.kind') = 'compaction' AND json_extract(event, '$.compactionId') = ? AND COALESCE(json_extract(event, '$.agentId'), '') = ? LIMIT 1",
        )
        .get(id, event.compactionId, event.agentId ?? '') as { seq: number; event: string } | undefined
      if (previous) {
        const earlier = JSON.parse(previous.event) as Extract<AgentEvent, { kind: 'compaction' }>
        const merged = { ...earlier, ...event, at: earlier.at }
        this.db.prepare(UPDATE_EVENT_SQL).run(JSON.stringify(merged), id, id, previous.seq)
        this.host.emit(id, merged, previous.seq)
        return
      }
    }
    if (event.kind === 'question-state') {
      const previous = this.db
        .prepare(
          "SELECT seq, event FROM agent_events WHERE session_id = ? AND json_extract(event, '$.kind') = 'question-state' AND json_extract(event, '$.requestId') = ? LIMIT 1",
        )
        .get(id, event.requestId) as { seq: number; event: string } | undefined
      if (previous) {
        const earlier = JSON.parse(previous.event) as Extract<AgentEvent, { kind: 'question-state' }>
        const merged = { ...earlier, ...event, answers: { ...earlier.answers, ...event.answers } }
        this.db.prepare(UPDATE_EVENT_SQL).run(JSON.stringify(merged), id, id, previous.seq)
        this.host.emit(id, merged, previous.seq)
        return
      }
    }
    if (
      event.kind === 'tool-use' ||
      event.kind === 'tool-result' ||
      (event.kind === 'content' && event.messageId) ||
      event.kind === 'plan' ||
      event.kind === 'turn-diff' ||
      (event.kind === 'text' && event.messageId) ||
      (event.kind === 'thinking' && event.messageId) ||
      event.kind === 'agent'
    ) {
      // Streamed text and sub-agent progress update their earlier event in place.
      const previous = (
        event.kind === 'tool-use'
          ? this.db
              .prepare(
                "SELECT seq, event FROM agent_events WHERE session_id = ? AND json_extract(event, '$.kind') = 'tool-use' AND json_extract(event, '$.toolUseId') = ? AND COALESCE(json_extract(event, '$.agentId'), '') = ? LIMIT 1",
              )
              .get(id, event.toolUseId, event.agentId ?? '')
          : event.kind === 'tool-result'
            ? this.db
                .prepare(
                  "SELECT seq FROM agent_events WHERE session_id = ? AND json_extract(event, '$.kind') = 'tool-result' AND json_extract(event, '$.toolUseId') = ? AND COALESCE(json_extract(event, '$.agentId'), '') = ? LIMIT 1",
                )
                .get(id, event.toolUseId, event.agentId ?? '')
            : event.kind === 'turn-diff'
              ? this.db
                  .prepare(
                    "SELECT seq FROM agent_events WHERE session_id = ? AND json_extract(event, '$.kind') = 'turn-diff' AND json_extract(event, '$.turnId') = ? LIMIT 1",
                  )
                  .get(id, event.turnId)
              : event.kind === 'agent'
                ? this.db
                    .prepare(
                      "SELECT seq, event FROM agent_events WHERE session_id = ? AND json_extract(event, '$.kind') = 'agent' AND json_extract(event, '$.agentId') = ? LIMIT 1",
                    )
                    .get(id, event.agentId)
                : this.db
                    .prepare(
                      "SELECT seq FROM agent_events WHERE session_id = ? AND json_extract(event, '$.messageId') IN (?, ?) LIMIT 1",
                    )
                    .get(id, (event as { messageId: string }).messageId, replacesMessageId ?? null)
      ) as { seq: number; event?: string } | undefined
      if (previous) {
        if (event.kind === 'agent' && previous.event && isStaleProgress(JSON.parse(previous.event) as AgentTask, event))
          return
        if (event.kind === 'tool-use' && previous.event) event.at = (JSON.parse(previous.event) as AgentEvent).at
        this.db.prepare(UPDATE_EVENT_SQL).run(JSON.stringify(event), id, id, previous.seq)
        this.host.emit(id, event, previous.seq)
        return
      }
    }
    this.db.prepare(INSERT_EVENT_SQL).run(id, id, id, JSON.stringify(event))
    const { seq } = this.db.prepare('SELECT MAX(seq) AS seq FROM agent_events WHERE session_id=?').get(id) as {
      seq: number
    }
    this.host.emit(id, event, seq)
    if (event.kind === 'request-resolved') this.host.notifyWaiters(id, event.requestId)
    if (event.kind === 'permission-request' && (event.approvalKey || event.productionDeploy)) {
      const request = event
      // Providers set needs-input immediately after emitting the request; answer after that transition.
      queueMicrotask(() => this.host.applySavedPermission(id, request))
    }
  }

  /** With a threshold set, a Claude command still running in the foreground after that long moves to the background on its own. */
  private armAutoBackground(id: string, toolUseId: string): void {
    const seconds = this.host.preferences()?.autoBackgroundSeconds ?? 0
    if (!seconds || !this.host.live.has(id)) return
    const timers = this.autoBackground.get(id) ?? new Map<string, NodeJS.Timeout>()
    this.autoBackground.set(id, timers)
    const fire = (): void => {
      const live = this.host.live.get(id)
      if (!live) return
      // A command waiting for approval has not started yet; count from when the user answers.
      if (this.host.get(id).state === 'needs-input') {
        timers.set(toolUseId, setTimeout(fire, seconds * 1000).unref())
        return
      }
      timers.delete(toolUseId)
      void live.query.backgroundTasks(toolUseId).catch(() => {})
    }
    timers.set(toolUseId, setTimeout(fire, seconds * 1000).unref())
  }

  private disarmAutoBackground(id: string, toolUseId?: string): void {
    const timers = this.autoBackground.get(id)
    if (!timers) return
    for (const key of toolUseId ? [toolUseId] : [...timers.keys()]) {
      clearTimeout(timers.get(key))
      timers.delete(key)
    }
    if (!timers.size) this.autoBackground.delete(id)
  }

  setState(id: string, state: AgentSessionState): void {
    // A turn that ended, stopped or waits on the person has nothing more to add to its replies.
    if (state !== 'running' && state !== 'starting') this.releaseText(id)
    if (state === 'failed') {
      const goal = this.host.getGoal(id)
      if (goal?.status === 'active')
        this.host.saveGoal(id, {
          ...goal,
          status: 'blocked',
          reason: 'The agent failed. Resolve the error, then resume the goal.',
          updatedAt: Date.now(),
        })
    }
    if (['idle', 'failed', 'stopped'].includes(state)) {
      this.activeTools.delete(id)
      this.disarmAutoBackground(id)
    }
    this.db.prepare('UPDATE agent_sessions SET state = ? WHERE id = ?').run(state, id)
    // Keep the checkout owned until the final snapshot is durable. Another chat
    // must not start writing between the provider result and review capture.
    // Background agents may still be changing files after the turn ends; the capture waits for the last one.
    if (['idle', 'failed', 'stopped'].includes(state) && !(state === 'idle' && this.host.pendingBackground(id)))
      this.finalize(id)
    this.syncTaskStatus(id)
    if (!this.host.children.has(id) && ['failed', 'stopped'].includes(state)) {
      const previous = this.host.latestEvent(id, 'state', 'user')
      if (previous?.kind !== 'state' || previous.state !== state) this.record(id, { kind: 'state', state })
      else this.host.emit(id, { kind: 'state', state })
    } else this.host.emit(id, { kind: 'state', state })
    const child = this.host.children.get(id)
    if (child && (state === 'running' || state === 'starting') && child.settled) {
      child.settled = false
      this.host.updateTask(child.parentId, id, { status: 'running', resumedAt: Date.now(), waitingFor: null })
    } else if (child && (state === 'running' || state === 'starting')) {
      this.host.updateTask(child.parentId, id, { waitingFor: null })
    } else if (child) this.host.settleChild(id)
    if (state === 'running')
      queueMicrotask(() => {
        void this.host.dispatchSteering(id)
      })
    if (state === 'idle')
      queueMicrotask(() => {
        void this.host.dispatchQueued(id)
      })
    if (['idle', 'failed', 'restored'].includes(state) && goalContinues(this.host.getGoal(id)))
      this.host.scheduleGoal(id)
    if (['idle', 'failed', 'stopped'].includes(state) && !this.host.reviewHooks()?.complete)
      this.host.wakeWorkspaceQueue()
  }

  finalize(id: string): void {
    // A sub-agent's changes are captured with its chat's review.
    if (!this.host.reviewHooks()?.complete || this.host.finalizing.has(id) || this.host.children.has(id)) return
    const operation = Promise.resolve().then(async () => {
      await this.host.draining.get(id)
      await this.host.reviewHooks()?.complete?.(id)
    })
    this.host.finalizing.set(id, operation)
    void operation
      .catch((error) => this.record(id, { kind: 'error', message: `Change capture failed: ${String(error)}` }))
      .finally(() => {
        this.host.finalizing.delete(id)
        if (this.host.get(id).state === 'idle') {
          this.host.workspaceQueue.add(id)
          this.host.wakeWorkspaceQueue()
        } else this.host.wakeWorkspaceQueue()
      })
  }

  /** A chat counts as running while any live session of it still has sub-agents or background tasks going. */
  syncTaskStatus(id: string): boolean {
    const session = this.host.get(id)
    const sessions = this.host.list(session.taskId)
    const latest = sessions.at(-1)
    const status = sessions.some((entry) => entry.state === 'needs-input')
      ? 'needs-input'
      : sessions.some(
            (entry) =>
              entry.state === 'running' ||
              entry.state === 'starting' ||
              ((this.host.live.has(entry.id) || this.host.runners.has(entry.id)) &&
                this.host.helperSummary(entry.id).active > 0),
          )
        ? 'running'
        : latest?.state === 'failed'
          ? 'failed'
          : latest?.state === 'idle'
            ? 'ready-for-review'
            : 'idle'
    const before = (
      this.db.prepare('SELECT status FROM tasks WHERE id = ?').get(session.taskId) as { status: string } | undefined
    )?.status
    this.db.prepare("UPDATE tasks SET status = ? WHERE id = ? AND status != 'archived'").run(status, session.taskId)
    return before !== undefined && before !== 'archived' && before !== status
  }
}
