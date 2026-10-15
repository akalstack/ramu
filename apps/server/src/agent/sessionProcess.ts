import { responseInstructions } from '../intelligence'
import { AcpResumeUnavailable } from '../providers/acp'
import { providerName, isAcpProvider } from '@ramu/shared/providers/providers'
import type { AgentRunner, AgentRunnerFactory } from './agentRunner'
import type { AppPreferences, AgentSessionInfo, AgentProvider, Attachment } from '@ramu/shared/types'
import { goalInstructions } from './goals'
import type { QueryFn, PendingRequest } from './types'
import { InputQueue } from './inputQueue'
import { errorMessage } from './util'
import { createCanUseTool } from './permissions'
import { claudeLaunchOptions } from './claudeOptions'
import { sessionGuidance } from './guidance'
import { conversationHandoff } from './handoff'
import { isUsageLimit } from './usageLimit'
import type { AdvisorService } from './advisorService'
import type { ContextUsageTracker } from './contextUsage'
import type { MessageDispatcher } from './messageDispatcher'
import type { GoalManager } from './goalManager'
import type { ProviderWaits } from './providerWait'
import type { ClaudeStreamPump } from './claudeStreamPump'
import type { SessionRecorder } from './sessionRecorder'
import type { SessionRegistry } from './sessionRegistry'
import type { UserRequests } from './userRequests'
import type { FallbackRouter } from './fallbackRouter'
import type { SessionStore } from './sessionStore'
import type { SubagentRunner } from './subagentRunner'
import type { AgentTasks } from './agentTasks'
import type { AgentService } from '../agent'
import type { Db } from '../db'

/** What SessionProcess needs from the rest of the service. */
export interface SessionProcessHost
  extends
    Pick<AdvisorService, 'advisorOn' | 'advisorStep'>,
    Pick<ContextUsageTracker, 'refreshContext' | 'setContext' | 'usageReader'>,
    Pick<MessageDispatcher, 'pauseQueue' | 'steering'>,
    Pick<GoalManager, 'controlGoal' | 'getGoal' | 'goalPreferences' | 'saveGoal' | 'setGoal'>,
    Pick<ProviderWaits, 'clearProviderWait' | 'waitForGoalProvider'>,
    Pick<ClaudeStreamPump, 'pump'>,
    Pick<SessionRecorder, 'record' | 'setState'>,
    Pick<
      SessionRegistry,
      'draining' | 'finalizing' | 'live' | 'revisions' | 'runners' | 'trackDrain' | 'transitioning'
    >,
    Pick<UserRequests, 'cancelWaiters' | 'hasBlockingQuestions' | 'questionStatus'>,
    Pick<FallbackRouter, 'fallback' | 'subagentSettings'>,
    Pick<SessionStore, 'events' | 'get' | 'hasRunningTasks' | 'isRecoveryPending' | 'task'>,
    Pick<SubagentRunner, 'children' | 'nativeSubagentsOff' | 'subagentHooks'>,
    Pick<AgentTasks, 'settleTasks' | 'updateTask'> {
  learningInstructions(): AgentService['learningInstructions']
  memoryInstructions(): AgentService['memoryInstructions']
  preferences(): AppPreferences | undefined
  preferencesSource(): (() => AppPreferences) | undefined
  providerQuery: QueryFn
  runnerFactory(provider: AgentProvider): AgentRunnerFactory
  sessionCheckpoint(): AgentService['sessionCheckpoint']
  shutdown(): AgentService['shutdown']
  toolConnection(): AgentService['toolConnection']
  usage(): AgentService['usage']
}

/** The provider process behind a session: launching it, halting it, interrupting it and failing it. */
export class SessionProcess {
  constructor(
    private readonly host: SessionProcessHost,
    private readonly db: Db,
  ) {}

  /** Whether a Codex chat's process was started without its own sub-agent tools. */
  private readonly nativeOffAtLaunch = new Map<string, boolean>()

  private readonly codexHookAtLaunch = new Map<string, boolean>()

  /**
   * Codex's sub-agent tools (and ACP runtimes' sub-agent settings) are fixed when the process starts. When the setup changes between messages (a new routing
   * mode, or the provider crossing the threshold), the idle process is replaced so the next message runs with the right
   * ones. Hook enable/disable also needs a restart. Running tasks defer it; an installed hook handles routing changes
   * without a restart.
   */
  async refreshProviderTools(id: string): Promise<void> {
    const s = this.host.get(id)
    const prefs = this.host.preferences()
    if (s.parentId || !prefs || !this.host.runners.has(id) || this.host.hasRunningTasks(id)) return
    if (isAcpProvider(s.provider)) {
      // OpenCode's tool permission and the Cursor/Antigravity guidance are fixed when the runtime starts; it resumes the same session.
      if (!this.nativeOffAtLaunch.has(id) || this.host.nativeSubagentsOff(s) === this.nativeOffAtLaunch.get(id)) return
    } else {
      if (s.provider !== 'codex') return
      const hook = prefs.subagents.codexHook
      let wanted: boolean
      try {
        wanted = !hook && (await this.host.subagentSettings(id)).redirect
      } catch {
        return
      }
      if (wanted === (this.nativeOffAtLaunch.get(id) ?? false) && hook === (this.codexHookAtLaunch.get(id) ?? false))
        return
    }
    this.host.transitioning.add(id)
    try {
      this.halt(id)
      await this.host.draining.get(id)
      this.host.setState(id, 'restored')
    } finally {
      this.host.transitioning.delete(id)
    }
  }

  responseStyleInstructions(session: AgentSessionInfo): string {
    const instructions = responseInstructions(session.settings, this.host.preferences()?.intelligence, session)
    const row = this.db
      .prepare('SELECT response_style_applied AS styled FROM agent_sessions WHERE id=?')
      .get(session.id) as { styled: number }
    if (instructions && !row.styled)
      this.db.prepare('UPDATE agent_sessions SET response_style_applied=1 WHERE id=?').run(session.id)
    if (instructions) return instructions
    return row.styled
      ? '<ramu-response-style>Use the default clear, direct response style, replacing earlier Ramu style preferences. Explicit user instructions still take precedence. Preserve exact code, commands, paths and structured output.</ramu-response-style>'
      : ''
  }

  launch(id: string, prompt: string, resume: string | null, recordUser = true, attachments: Attachment[] = []): void {
    const s = this.host.get(id)
    const explicitGoal = !s.parentId && /^\/goal\s+(\S[\s\S]*)$/.exec(prompt.split('\n\n<ramu-context>')[0]!.trim())
    if (explicitGoal) this.host.setGoal(id, explicitGoal[1]!, true)
    const handoff = !resume && this.host.events(id).some((e) => e.kind === 'settings' && e.handoff)
    const connection = this.host.toolConnection()?.(s)
    if (connection) {
      connection.instructions = sessionGuidance({
        asyncQuestions: this.host.preferences()?.asyncQuestions !== false,
        background: (this.host.preferences()?.autoBackgroundSeconds ?? 1) !== 0,
        advisor: !!this.host.advisorStep(id),
        goal: !s.parentId ? goalInstructions(this.host.goalPreferences(), this.host.getGoal(id)) : null,
        nativeSubagentNote:
          (s.provider === 'cursor' || s.provider === 'antigravity') && this.host.nativeSubagentsOff(s),
        memory: this.host.memoryInstructions()?.(s),
        toolSearch: this.host.preferences()?.intelligence?.toolSearch !== false,
        learning: this.host.learningInstructions()?.(s),
      })
    }
    if (connection && this.host.nativeSubagentsOff(s)) connection.nativeSubagents = false
    if (isAcpProvider(s.provider) && connection && !s.parentId)
      this.nativeOffAtLaunch.set(id, connection.nativeSubagents === false)
    const request = explicitGoal ? prompt.replace(/^\s*\/goal\s+/, 'Work toward this Ramu goal: ') : prompt
    const style = this.responseStyleInstructions(s)
    const styledRequest = style ? `${request}\n\n${style}` : request
    const actualPrompt = handoff
      ? `${conversationHandoff(this.host.events(id), this.host.sessionCheckpoint()?.(id))}\n\nNext request: ${styledRequest}`
      : styledRequest
    if (s.provider !== 'claude-code') {
      let runner: AgentRunner
      try {
        runner = this.host.runnerFactory(s.provider)(s, s.settings, (event, limit) => {
          if (this.host.runners.get(id) !== runner) return
          if (event.kind === 'usage') {
            this.host.usage()?.update(event.readings)
            return
          }
          if (event.kind === 'context') {
            this.host.setContext(id, event.used, event.max)
            return
          }
          if (event.kind === 'init')
            this.db
              .prepare('UPDATE agent_sessions SET provider_session_id = ? WHERE id = ?')
              .run(event.providerSessionId, id)
          if (event.kind === 'state')
            this.host.setState(
              id,
              event.state === 'running' && this.host.hasBlockingQuestions(id) ? 'needs-input' : event.state,
            )
          else if (event.kind === 'agent') {
            const { kind: _, at: __, ...task } = event
            if (this.host.task(id, task.agentId)?.status !== 'stopped') this.host.updateTask(id, task.agentId, task)
          } else {
            this.host.record(id, event.kind === 'init' ? { ...event, provider: s.provider } : event)
            if (event.kind === 'result') {
              if (limit && event.isError) void this.host.fallback(id)
              else this.host.setState(id, event.isError ? 'failed' : 'idle')
            }
          }
        })
        if (connection) runner.setTools?.(connection)
        this.host.runners.set(id, runner)
        if (recordUser)
          this.host.record(id, { kind: 'user', text: prompt, ...(attachments.length ? { attachments } : {}) })
        this.host.setState(id, 'starting')
        void (async () => {
          if (connection && s.provider === 'codex' && !s.parentId) {
            const hook = !!this.host.preferences()?.subagents.codexHook
            const nativeOff = !hook && (await this.host.subagentSettings(id)).redirect
            if (this.host.runners.get(id) !== runner) return
            connection.nativeSubagents = nativeOff ? false : undefined
            connection.interceptSubagents = hook
            this.nativeOffAtLaunch.set(id, nativeOff)
            this.codexHookAtLaunch.set(id, hook)
            runner.setTools?.(connection)
          }
          if (this.host.runners.get(id) === runner)
            await runner.start(
              s.provider === 'codex' || !connection?.instructions
                ? actualPrompt
                : `<ramu-session-guidance>\n${connection.instructions}\n</ramu-session-guidance>\n\n${actualPrompt}`,
              resume,
              attachments,
            )
        })().catch(async (e) => {
          if (this.host.runners.get(id) !== runner) return
          this.halt(id)
          // A runtime that cannot continue its saved session still gets the whole conversation, as when switching providers.
          if (e instanceof AcpResumeUnavailable && resume && !this.host.shutdown()) {
            await this.host.draining.get(id)
            this.db.prepare('UPDATE agent_sessions SET provider_session_id = NULL WHERE id = ?').run(id)
            this.host.record(id, {
              kind: 'settings',
              settings: s.settings,
              reason: `${providerName(s.provider)} could not resume its saved session — continuing from the conversation`,
              handoff: true,
              previous: s.settings,
            })
            this.launch(id, prompt, null, false, attachments)
            return
          }
          this.fail(id, e)
        })
      } catch (e) {
        this.fail(id, e)
      }
      return
    }
    const input = new InputQueue()
    const abort = new AbortController()
    const pending = new Map<string, PendingRequest>()
    const canUseTool = createCanUseTool({
      settings: s.settings,
      pending,
      record: (event) => this.host.record(id, event),
      setState: (state) => this.host.setState(id, state),
    })
    const query = this.host.providerQuery({
      prompt: input,
      options: claudeLaunchOptions({
        session: s,
        connection,
        advisorOn: this.host.advisorOn(),
        abort,
        canUseTool,
        resume,
        preferences: this.host.preferencesSource(),
        hooks: !s.parentId && this.host.preferencesSource() ? this.host.subagentHooks(id) : undefined,
      }),
    })
    this.host.live.set(id, { query, input, abort, pending })
    if (recordUser) this.host.record(id, { kind: 'user', text: prompt, ...(attachments.length ? { attachments } : {}) })
    input.push(actualPrompt, attachments)
    this.host.setState(id, resume ? 'running' : 'starting')
    this.host.live.get(id)!.done = this.host.pump(id, query)
    this.host.refreshContext(id, query)
    this.host.usageReader.refresh(query, s.settings.accountId ?? 'default')
  }

  halt(id: string): void {
    this.host.cancelWaiters(id)
    for (const event of this.host.events(id))
      if (
        event.kind === 'question' &&
        event.responseMode === 'ramu' &&
        !this.host.questionStatus(id, event.requestId).outcome
      )
        this.host.record(id, { kind: 'request-resolved', requestId: event.requestId, outcome: 'cancelled' })
    const codex = this.host.runners.get(id)
    this.nativeOffAtLaunch.delete(id)
    this.codexHookAtLaunch.delete(id)
    if (codex || this.host.live.has(id)) this.host.settleTasks(id)
    if (codex) {
      this.host.runners.delete(id)
      this.host.trackDrain(id, codex.stop())
      this.host.setState(id, 'stopped')
    }
    const live = this.host.live.get(id)
    if (!live) return
    for (const [requestId, p] of live.pending) {
      p.resolve({ behavior: 'deny', message: 'Session stopped by the user', interrupt: true })
      this.host.record(id, { kind: 'request-resolved', requestId, outcome: 'cancelled' })
    }
    live.pending.clear()
    live.input.close()
    live.abort.abort()
    live.query.close?.()
    this.host.trackDrain(id, live.done ?? Promise.resolve())
    this.host.live.delete(id)
    this.host.setState(id, 'stopped')
  }

  stop(id: string): void {
    if (!this.host.shutdown()) this.host.clearProviderWait(id)
    if (!this.host.shutdown() && this.host.getGoal(id) && this.host.getGoal(id)?.status !== 'completed')
      this.host.controlGoal(id, 'pause')
    if (!this.host.shutdown() && this.host.isRecoveryPending(id)) {
      this.db.prepare('DELETE FROM agent_recovery WHERE session_id = ?').run(id)
      this.host.setState(id, 'stopped')
    }
    for (const [childId, run] of this.host.children) if (run.parentId === id) this.stop(childId)
    this.host.pauseQueue(id)
    this.host.revisions.set(id, (this.host.revisions.get(id) ?? 0) + 1)
    this.halt(id)
    if (!this.host.live.has(id) && !this.host.runners.has(id)) this.host.setState(id, 'stopped')
    if (this.host.transitioning.has(id)) this.host.setState(id, 'stopped')
  }

  async stopAndWait(id: string): Promise<void> {
    this.stop(id)
    await this.host.draining.get(id)
    await this.host.finalizing.get(id)
    // Steering has a batching delay and may still inspect the session after its runner stops.
    // Keep the database available until that pending dispatch has finished too.
    while (this.host.steering.has(id)) await new Promise((resolve) => setTimeout(resolve, 5))
  }

  async interrupt(id: string): Promise<void> {
    this.host.clearProviderWait(id)
    if (this.host.getGoal(id) && this.host.getGoal(id)?.status !== 'completed') this.host.controlGoal(id, 'pause')
    this.host.pauseQueue(id)
    if (this.host.runners.has(id)) await this.host.runners.get(id)!.interrupt()
    else await this.host.live.get(id)?.query.interrupt()
  }

  fail(id: string, error: unknown): void {
    this.host.record(id, { kind: 'error', message: errorMessage(error) })
    if (isUsageLimit(error) && this.host.waitForGoalProvider(id)) return
    const goal = this.host.getGoal(id)
    if (goal?.status === 'active')
      this.host.saveGoal(id, { ...goal, status: 'blocked', reason: errorMessage(error), updatedAt: Date.now() })
    this.host.setState(id, 'failed')
  }
}
