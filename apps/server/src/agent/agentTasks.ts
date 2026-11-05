import { isAcpProvider } from '@ramu/shared/providers/providers'
import type { AgentTask } from '@ramu/shared/types'
import { helperWork, isStaleProgress, taskMessagePrompt, taskStopPrompt } from '@ramu/shared/chat/agentTasks'
import { teammateCatchUp } from '@ramu/shared/chat/teammateMentions'
import { redactSecrets } from '../memory/secrets'
import { transcriptOf } from './handoff'
import type { ChildRun } from './types'
import { WRITING_STATES } from './constants'
import { isUsageLimit } from './usageLimit'
import type { AdvisorService } from './advisorService'
import type { MessageDispatcher } from './messageDispatcher'
import type { SessionProcess } from './sessionProcess'
import type { ClaudeStreamPump } from './claudeStreamPump'
import type { SessionRecorder } from './sessionRecorder'
import type { SessionRegistry } from './sessionRegistry'
import type { SessionStore } from './sessionStore'
import type { SubagentRunner } from './subagentRunner'
import type { ProviderWaits } from './providerWait'
import type { Db } from '../db'
import { clipTextEnd } from '@ramu/shared/text'

/** Without a cursor (after a restart), how much of the lead's thread a teammate's catch-up covers. */
const CATCH_UP_EVENTS = 40
/** The most of the conversation one catch-up carries; the newest part is kept. */
const CATCH_UP_CHARS = 40_000

/** What AgentTasks needs from the rest of the service. */
export interface AgentTasksHost
  extends
    Pick<AdvisorService, 'abortAdvice'>,
    Pick<MessageDispatcher, 'submit' | 'wakeWorkspaceQueue'>,
    Pick<SessionProcess, 'stopAndWait'>,
    Pick<ClaudeStreamPump, 'agentCalls'>,
    Pick<SessionRecorder, 'finalize' | 'record' | 'syncTaskStatus'>,
    Pick<SessionRegistry, 'live' | 'runners'>,
    Pick<SessionStore, 'emit' | 'events' | 'get' | 'hasRunningTasks' | 'task'>,
    Pick<ProviderWaits, 'providerWait'>,
    Pick<SubagentRunner, 'children' | 'continueNative' | 'wakeTeammate'> {}

/** The sub-agents and background commands inside a chat: recording their state and stopping or messaging them. */
export class AgentTasks {
  constructor(
    private readonly host: AgentTasksHost,
    private readonly db: Db,
  ) {}

  /** Records a sub-agent's new state, keeping when it was first seen. */
  updateTask(id: string, agentId: string, patch: Partial<AgentTask>): void {
    const current = this.host.task(id, agentId) as (AgentTask & { at?: number }) | null
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([key, value]) => value !== undefined && !(key === 'name' && value === '')),
    ) as Partial<AgentTask>
    if (defined.resumedAt && current?.status !== 'running' && defined.resumedAt >= (current?.endedAt ?? 0))
      defined.resumedAt = Math.max(defined.resumedAt, (current?.endedAt ?? 0) + 1)
    if (isStaleProgress(current, defined)) return
    const next: AgentTask = { name: 'Agent', status: 'running', ...current, ...defined, agentId }
    if (defined.status === 'running' && defined.resumedAt) {
      delete next.endedAt
      delete next.durationMs
      next.startedAt = defined.resumedAt
      next.recovered = false
    }
    this.host.record(id, { ...next, kind: 'agent', ...(current?.at ? { at: current.at } : {}) })
    // The sidebar shows a chat as working while its agents run, and settles when they finish.
    if (this.host.syncTaskStatus(id)) this.host.emit(id, { kind: 'state', state: this.host.get(id).state })
    // The last background agent finished after the turn: capture the changes now, and let other chats in.
    if (
      current?.status === 'running' &&
      next.status !== 'running' &&
      this.host.get(id).state === 'idle' &&
      !this.host.hasRunningTasks(id)
    ) {
      this.host.finalize(id)
      this.host.wakeWorkspaceQueue()
    }
    if (
      current?.status === 'running' &&
      next.status === 'failed' &&
      !this.host.children.has(agentId) &&
      isUsageLimit(`${next.error ?? ''} ${next.summary ?? ''}`)
    )
      this.host.continueNative(id, next)
  }

  /** When the main agent goes away, whatever it was still running goes with it. */
  settleTasks(id: string): void {
    const rows = this.db
      .prepare(
        "SELECT event FROM agent_events WHERE session_id = ? AND json_extract(event, '$.kind') = 'agent' AND json_extract(event, '$.status') = 'running'",
      )
      .all(id) as { event: string }[]
    for (const row of rows) {
      const agentId = (JSON.parse(row.event) as AgentTask).agentId
      this.host.abortAdvice(agentId)
      // A sub-agent Ramu runs is its own process: it outlives a provider switch of its chat. One held at a usage limit has no
      // process but is not over: it continues after the reset, so its card must not be settled as stopped with its chat's.
      if (
        this.host.children.has(agentId) &&
        (this.host.live.has(agentId) || this.host.runners.has(agentId) || this.host.providerWait(agentId))
      )
        continue
      this.updateTask(id, agentId, { status: 'stopped', endedAt: Date.now() })
    }
    this.host.agentCalls.delete(id)
  }

  async stopTask(id: string, agentId: string): Promise<void> {
    const task = this.host.task(id, agentId)
    if (!task || task.status !== 'running') throw new Error('That agent is not running.')
    if (task.canStop !== true) throw new Error('This agent cannot be stopped directly.')
    if (task.taskType === 'advisor') {
      this.updateTask(id, agentId, { status: 'stopped', summary: '', endedAt: Date.now() })
      this.host.abortAdvice(agentId)
      return
    }
    if (this.host.children.get(agentId)?.parentId === id) {
      await this.host.stopAndWait(agentId)
      return
    }
    const live = this.host.live.get(id)
    if (live) {
      await live.query.stopTask(agentId)
      return
    }
    // An ACP runtime's own helper runs inside the turn: steering cancels the turn, which ends the helper, then continues.
    if (
      this.host.runners.has(id) &&
      (isAcpProvider(this.host.get(id).provider) || this.host.get(id).provider === 'claude-code')
    ) {
      this.updateTask(id, agentId, { status: 'stopped', canStop: false, endedAt: Date.now() })
      await this.host.submit(
        id,
        `The user stopped the sub-agent "${task.name.replace(/"/g, "'")}". Do not restart it; carry on without its result.`,
        'steer',
        [],
        undefined,
        true,
      )
      return
    }
    if (this.host.runners.has(id)) {
      await this.host.submit(id, taskStopPrompt(task), 'steer', [], undefined, true)
      return
    }
    throw new Error('That agent is no longer running.')
  }

  /**
   * Takes a teammate out of the thread: it stops if it is working, and once ended neither the lead nor the person can
   * address it, so a thread with many teammates can let go of the ones it no longer needs. A finished teammate cannot
   * be stopped, so without this it stayed in the conversation for good.
   */
  async dismissTeammate(id: string, agentId: string): Promise<void> {
    const task = this.host.task(id, agentId)
    if (!task?.teammate) throw new Error('That is not a teammate in this thread.')
    if (task.status === 'stopped' || task.status === 'failed') return
    if (task.status === 'running' && task.canStop === true) await this.stopTask(id, agentId)
    // A teammate between turns still holds its own session; end it too, so it frees what it used.
    else if (this.host.children.get(agentId)?.parentId === id) await this.host.stopAndWait(agentId)
    if (this.host.task(id, agentId)?.status !== 'stopped')
      this.updateTask(id, agentId, { status: 'stopped', canMessage: false, endedAt: task.endedAt ?? Date.now() })
  }

  async messageTask(id: string, agentId: string, message: string): Promise<void> {
    let text = message
    const task = this.host.task(id, agentId)
    if (!task?.canMessage) throw new Error('This agent cannot receive messages.')
    if (task.teammate) this.host.wakeTeammate(id, agentId)
    const run = this.host.children.get(agentId)
    if (run?.teammate && run.parentId === id) text = `${this.catchUp(id, run)}${text}`
    if (run?.parentId === id) {
      // Straight to the sub-agent; its next report comes back as a message.
      run.report = true
      if (run.asking) {
        run.asking(text.trim())
        return
      }
      const child = this.host.get(agentId)
      await this.host.submit(
        agentId,
        text.trim(),
        WRITING_STATES.includes(child.state) ? 'steer' : 'queue',
        [],
        undefined,
        true,
      )
      return
    }
    const session = this.host.get(id)
    await this.host.submit(
      id,
      taskMessagePrompt(session.provider, task, text.trim()),
      WRITING_STATES.includes(session.state) ? 'steer' : 'queue',
      [],
      undefined,
      true,
    )
  }

  /**
   * What the lead's thread said and changed since a teammate last took part. After a restart the cursor is gone, so the
   * last stretch of the conversation stands in for it.
   */
  private catchUp(id: string, run: ChildRun): string {
    const events = this.host.events(id)
    const since = Math.min(run.seenParent ?? Math.max(0, events.length - CATCH_UP_EVENTS), events.length)
    run.seenParent = events.length
    // Its own reports and notes are already in its own session.
    const own = [`[Sub-agent "${run.name.replace(/"/g, "'")}"`, `[Teammate "${run.name.replace(/"/g, "'")}"`]
    const missed = events
      .slice(since)
      .filter((event) => !(event.kind === 'user' && own.some((prefix) => event.text.startsWith(prefix))))
    const transcript = clipTextEnd(redactSecrets(transcriptOf(missed)), CATCH_UP_CHARS)
    return teammateCatchUp(transcript, helperWork(missed).paths)
  }

  /** Moves a running command to the background, as Ctrl+B does in Claude Code. The turn goes on and the result arrives as a task notification. */
  async backgroundTool(id: string, toolUseId: string): Promise<boolean> {
    const live = this.host.live.get(id)
    if (!live) throw new Error('Only a running Claude thread can move a command to the background.')
    return live.query.backgroundTasks(toolUseId)
  }
}
