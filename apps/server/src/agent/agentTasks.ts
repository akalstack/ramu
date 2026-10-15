import { isAcpProvider } from '@ramu/shared/providers/providers'
import type { AgentTask } from '@ramu/shared/types'
import { taskMessagePrompt, taskStopPrompt } from '@ramu/shared/chat/agentTasks'
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
import type { Db } from '../db'

/** What AgentTasks needs from the rest of the service. */
export interface AgentTasksHost
  extends
    Pick<AdvisorService, 'abortAdvice'>,
    Pick<MessageDispatcher, 'submit' | 'wakeWorkspaceQueue'>,
    Pick<SessionProcess, 'stopAndWait'>,
    Pick<ClaudeStreamPump, 'agentCalls'>,
    Pick<SessionRecorder, 'finalize' | 'record' | 'syncTaskStatus'>,
    Pick<SessionRegistry, 'live' | 'runners'>,
    Pick<SessionStore, 'emit' | 'get' | 'hasRunningTasks' | 'task'>,
    Pick<SubagentRunner, 'children' | 'continueNative'> {}

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
    const next: AgentTask = { name: 'Agent', status: 'running', ...current, ...defined, agentId }
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
      // A sub-agent Ramu runs is its own process: it outlives a provider switch of its chat.
      if (this.host.children.has(agentId) && (this.host.live.has(agentId) || this.host.runners.has(agentId))) continue
      this.updateTask(id, agentId, { status: 'stopped', endedAt: Date.now() })
    }
    this.host.agentCalls.delete(id)
  }

  async stopTask(id: string, agentId: string): Promise<void> {
    const task = this.host.task(id, agentId)
    if (!task || task.status !== 'running') throw new Error('That agent is not running.')
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

  async messageTask(id: string, agentId: string, text: string): Promise<void> {
    const task = this.host.task(id, agentId)
    if (!task?.canMessage) throw new Error('This agent cannot receive messages.')
    const run = this.host.children.get(agentId)
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

  /** Moves a running command to the background, as Ctrl+B does in Claude Code. The turn goes on and the result arrives as a task notification. */
  async backgroundTool(id: string, toolUseId: string): Promise<boolean> {
    const live = this.host.live.get(id)
    if (!live) throw new Error('Only a running Claude chat can move a command to the background.')
    return live.query.backgroundTasks(toolUseId)
  }
}
