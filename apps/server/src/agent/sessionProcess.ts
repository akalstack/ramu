import { asProcessOwner, claudeSpawn } from './processOwners'
import { READ_ONLY_DENIED } from './permissions'
import { createHash } from 'node:crypto'
import { serversDigest, sessionMcpServers } from '../providers/discoveredMcp'
import { ruleDelivery } from '@ramu/shared/rules'
import { UPDATE_EVENT_SQL } from './eventRevision'
import { providerName, isAcpProvider } from '@ramu/shared/providers/providers'
import { requestOutcomes } from '@ramu/shared/chat/questions'
import { ResumeUnavailable, SessionInUse, type AgentRunner, type AgentRunnerFactory } from './agentRunner'
import type {
  AppPreferences,
  GoalPreferences,
  AgentEvent,
  AgentProvider,
  AgentSessionInfo,
  AgentSettings,
  Attachment,
  HandoffCause,
  HandoffInfo,
  McpConnection,
  MessageOrigin,
} from '@ramu/shared/types'
import { DEFAULT_INTELLIGENCE_PREFERENCES, DEFAULT_MEMORY_PREFERENCES } from '@ramu/shared/types'
import { goalInstructions } from './goals'
import type { QueryFn, PendingRequest } from './types'
import { InputQueue, userEvent } from './inputQueue'
import { errorMessage } from './util'
import { helperRoleReadOnly } from '@ramu/shared/chat/helperRoles'
import { alwaysAskHooks, claudeHooks, createCanUseTool, readOnlyBashHooks } from './permissions'
import { ramuFileHooks } from './ramuFiles'
import { claudeLaunchOptions } from './claudeOptions'
import { sessionGuidance } from './guidance'
import { nativeToolSearch, usesRamuQuestionTools, usesRamuToolSearch } from './nativeFeatures'
import { buildHandoff, handoffBudgetBytes, DEFAULT_CONTEXT_TOKENS, type BuiltHandoff } from './handoff'
import { ProviderSessions, pendingHandoff, planHandoff } from './providerSessions'
import { classifyLimit } from '../providers/limitClassifier'
import { providerAdapter } from '../providers/adapters'
import { acpTerminalHostFor } from '../providers/acpTerminals'
import { sameProviderIdentity } from '../providers/selectionTransition'
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
import { launchCompatibility, ProviderIncompatibleError } from '../providers/launchCompatibility'
import type { AgentTasks } from './agentTasks'
import type { AgentService } from '../agent'
import type { Db } from '../db'

/** The settings a chat's tools and instructions were built from when its process launched. */
export interface LaunchSettings {
  asyncQuestions: boolean
  goalMode: GoalPreferences['mode']
  advisor: boolean
  memory: boolean
  crossThreadRecall: boolean
}

/** What SessionProcess needs from the rest of the service. */
export interface SessionProcessHost
  extends
    Pick<AdvisorService, 'advisorStep' | 'claudeAdvisorModel'>,
    Pick<
      ContextUsageTracker,
      'context' | 'modelContextWindow' | 'clearContext' | 'refreshContext' | 'setContext' | 'usageReader'
    >,
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
    Pick<FallbackRouter, 'fallback' | 'retryQuietly' | 'subagentSettings'>,
    Pick<SessionStore, 'emit' | 'events' | 'get' | 'hasRunningTasks' | 'isRecoveryPending' | 'queued' | 'task'>,
    Pick<SubagentRunner, 'children' | 'nativeSubagentsOff' | 'subagentHooks' | 'cancelPendingStarts'>,
    Pick<AgentTasks, 'settleTasks' | 'updateTask'> {
  learningInstructions(): AgentService['learningInstructions']
  memoryInstructions(): AgentService['memoryInstructions']
  rulesInstructions(): AgentService['rulesInstructions']
  preferences(): AppPreferences | undefined
  preferencesSource(): (() => AppPreferences) | undefined
  providerQuery: QueryFn
  runnerFactory(provider: AgentProvider): AgentRunnerFactory
  usesRunner(provider: AgentProvider): boolean
  sessionCheckpoint(): AgentService['sessionCheckpoint']
  shutdown(): AgentService['shutdown']
  toolConnection(): AgentService['toolConnection']
  usage(): AgentService['usage']
  providerTitle(): AgentService['providerTitle']
}

/** The provider process behind a session: launching it, halting it, interrupting it and failing it. */
export class SessionProcess {
  constructor(
    private readonly host: SessionProcessHost,
    private readonly db: Db,
  ) {}

  /** A digest of the servers each runner was launched with, to notice when its sources change under a running thread. */
  private readonly launchServers = new Map<string, string>()

  private serversNow(s: AgentSessionInfo, connection: McpConnection | undefined): string {
    return serversDigest(
      sessionMcpServers(s, connection, s.provider, s.settings.accountId, connection?.sharingProjectId),
    )
  }

  /**
   * A digest of the rules each session was last handed. A runtime that takes rules only ahead of its first message gets
   * the changed set with the next message of a resumed session; after a restart nothing is known, so nothing repeats.
   */
  private readonly rulesDelivered = new Map<string, string>()

  /**
   * The changed rules for a session that already has them, as a labelled block to put ahead of its next message; only for
   * runtimes that take rules ahead of the first message. Undefined when nothing changed or nothing is known to compare.
   */
  rulesUpdate(id: string, provider: AgentProvider, rulesText: string | undefined, native: boolean): string | undefined {
    if (!rulesText) {
      this.rulesDelivered.delete(id)
      return undefined
    }
    const digest = createHash('sha256').update(rulesText).digest('hex')
    const before = this.rulesDelivered.get(id)
    this.rulesDelivered.set(id, digest)
    if (native && before && before !== digest && ruleDelivery(provider).path === 'first-message')
      return `Your rules changed since this session started. Follow this set from now on instead of the earlier one:\n\n${rulesText}\n\n`
    return undefined
  }

  /** Whether a Codex chat's process was started without its own sub-agent tools. */
  private readonly nativeOffAtLaunch = new Map<string, boolean>()
  /** Sessions whose launch instructions carry the goal policy; the others get it with their first goal turn. */
  readonly goalPolicySent = new Set<string>()

  private readonly codexHookAtLaunch = new Map<string, boolean>()
  /** The settings that shape a running process's tools and instructions; a settings change applies at its next launch. */
  private readonly launchPins = new Map<string, LaunchSettings>()

  launchSettings(id: string): LaunchSettings {
    return this.launchPins.get(id) ?? this.currentSettings(id)
  }

  private currentSettings(id: string): LaunchSettings {
    const prefs = this.host.preferences()
    return {
      asyncQuestions: prefs?.asyncQuestions !== false,
      goalMode: this.host.goalPreferences().mode,
      advisor: !!this.host.advisorStep(id),
      memory: prefs?.memory?.enabled ?? DEFAULT_MEMORY_PREFERENCES.enabled,
      crossThreadRecall: prefs?.intelligence?.crossThreadRecall ?? DEFAULT_INTELLIGENCE_PREFERENCES.crossThreadRecall,
    }
  }

  private get sessions(): ProviderSessions {
    return (this.savedSessions ??= new ProviderSessions(this.db))
  }

  private savedSessions: ProviderSessions | undefined

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
    // Servers the person changed in Agent setup are fixed when a runner starts; the next message restarts it on the same
    // session, once no work is running, so the change reaches this thread without a new one.
    const launched = this.launchServers.get(id)
    const serversChanged = launched !== undefined && launched !== this.serversNow(s, this.host.toolConnection()?.(s))
    if (serversChanged) {
      // fall through to the restart below
    } else if (isAcpProvider(s.provider) || s.provider === 'claude-code') {
      // Sub-agent switches for OpenCode, Cursor and Antigravity are fixed when the runner starts; it resumes the same session.
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

  /** Saves the thread's current native session with how much of the thread it has seen, before the thread leaves it. */
  rememberSession(id: string): void {
    const s = this.host.get(id)
    if (s.providerSessionId)
      this.sessions.save(
        id,
        s.provider,
        s.settings.accountId,
        s.providerSessionId,
        this.host.events(id).length,
        this.host.context(id)?.max ?? null,
        s.settings.model,
        this.host.context(id)?.used ?? null,
      )
  }

  /**
   * How the thread would reach another login: which native session to resume (a returning provider) and whether the handoff
   * fits it. Nothing changes; the caller decides, then records `info` on the `settings` event.
   */
  planSwitch(
    id: string,
    target: { provider: AgentProvider; accountId?: string; model?: string },
    cause: HandoffCause,
    freshSession = false,
    contextTokens?: number | null,
  ): { resume: string | null; info: HandoffInfo; fits: boolean } {
    const s = this.host.get(id)
    const model = target.model ?? (target.provider === s.provider ? s.settings.model : '')
    const window = contextTokens ?? this.host.modelContextWindow({ ...target, model })
    const plan = planHandoff(this.host.events(id), {
      cause,
      from: s.provider,
      to: target.provider,
      saved: freshSession ? null : this.sessions.get(id, target.provider, target.accountId),
      model,
      contextTokens: window,
      checkpoint: this.host.sessionCheckpoint()?.(id) ?? null,
      goal: !this.host.toolConnection() && !s.parentId ? (this.host.getGoal(id)?.objective ?? null) : null,
      queued: this.host.queued(id),
    })
    return { resume: plan.resume, info: pendingHandoff(plan, cause, s.provider), fits: !plan.built.overBudget }
  }

  /** Preflight every manual or automatic settings change while the live runner still has its capabilities. */
  planTransition(
    id: string,
    target: AgentSettings,
    cause: HandoffCause,
    contextTokens?: number,
  ): { resume: string | null; info?: HandoffInfo; fits: boolean } {
    const s = this.host.get(id)
    const observedWindow = this.host.modelContextWindow(target)
    const window = contextTokens == null ? observedWindow : Math.min(contextTokens, observedWindow ?? Infinity)
    if (!sameProviderIdentity(s.settings, target)) return this.planSwitch(id, target, cause, false, window)
    const transition =
      this.host.runners.get(id)?.planSettingsTransition?.(target) ?? providerAdapter(s.provider).selectionTransition
    if (transition.type === 'reject') throw new Error(transition.reason)
    const context = this.host.context(id)
    const modelChanged = s.settings.model !== target.model
    // An unknown destination cannot inherit the outgoing model's capacity. A smaller window needs room for native history,
    // instructions and the next turn; if usage is unavailable, use a fresh session when shrinking or changing to an unknown window.
    const fitsNative = modelChanged
      ? window != null && context != null && context.used <= window * 0.75
      : window == null || context == null || context.used <= window * 0.75
    if (transition.type === 'restart-and-resume' && s.providerSessionId && fitsNative)
      return { resume: s.providerSessionId, fits: true }
    // A fresh session must never pick the same incompatible saved session back up as a delta.
    return this.planSwitch(id, target, cause, true, window)
  }

  /**
   * The handoff a launch needs, or null when the provider already has the conversation. A returning provider resumes its own
   * session and gets only what it missed (a delta); one that does not have a session gets the whole conversation. Records what
   * was carried on the `settings` event that asked for it, or on a new one when nothing had (a session lost without a record).
   * 'too-large' means the conversation does not fit the target even after compaction, so nothing is sent.
   */
  private carry(
    id: string,
    resume: string | null,
    hasGuidance: boolean,
    request: string,
    attachments: Attachment[],
  ): { resume: string | null; built: BuiltHandoff } | 'too-large' | null {
    const s = this.host.get(id)
    const events = this.host.events(id)
    const at = events.findLastIndex((e) => e.kind === 'settings' && e.handoff)
    const marked = at >= 0 ? (events[at] as Extract<AgentEvent, { kind: 'settings' }>) : null
    const info = marked?.handoffInfo
    const undelivered = !!info && info.toSeq === undefined
    const delta = !!resume && undelivered && info.mode === 'delta'
    // A launch without a native session needs the conversation however the session was lost, so a path that forgot to say so
    // cannot leave the provider without it.
    const hasHistory = events.some((e) => !e.agentId && (e.kind === 'user' || e.kind === 'text'))
    if (!delta && !(!resume && (marked || hasHistory))) return null
    const cause = undelivered ? info.cause : 'resume-unavailable'
    const saved = this.sessions.get(id, s.provider, s.settings.accountId)
    const sameProvider = cause === 'rewind' || cause === 'resume-unavailable' || cause === 'move'
    const contextTokens =
      (undelivered ? info?.contextWindow : null) ??
      this.host.modelContextWindow(s.settings) ??
      (sameProvider ? this.host.context(id)?.max : null)
    const inputTokens = Buffer.byteLength(request, 'utf8') + attachments.length * 8192
    const budgetBytes = Math.min(
      handoffBudgetBytes(contextTokens),
      Math.max(0, Math.floor((contextTokens ?? DEFAULT_CONTEXT_TOKENS) * 0.75) - inputTokens),
    )
    const common = {
      cause,
      from: undelivered ? info.from : s.provider,
      to: s.provider,
      // Providers that receive session guidance already get the goal there.
      goal: !hasGuidance && !s.parentId ? (this.host.getGoal(id)?.objective ?? null) : null,
      queued: this.host.queued(id),
      budgetBytes,
      ...(contextTokens ? { contextWindow: contextTokens } : {}),
    }
    const checkpoint = this.host.sessionCheckpoint()?.(id) ?? null
    let native = resume
    let built = buildHandoff(
      events,
      delta ? { ...common, mode: 'delta', fromSeq: info.fromSeq } : { ...common, mode: 'full', checkpoint },
    )
    const fitsNative =
      (saved?.contextUsed ?? 0) + Buffer.byteLength(built.prompt, 'utf8') + inputTokens <=
      (contextTokens ?? DEFAULT_CONTEXT_TOKENS) * 0.75
    if (delta && (built.overBudget || !fitsNative)) {
      native = null
      built = buildHandoff(events, { ...common, mode: 'full', checkpoint })
    }
    if (built.overBudget) return 'too-large'
    if (marked && undelivered) {
      const patched = { ...marked, handoffInfo: built.info }
      this.db.prepare(UPDATE_EVENT_SQL).run(JSON.stringify(patched), id, id, at + 1)
      this.host.emit(id, patched, at + 1)
    } else
      this.host.record(id, {
        kind: 'settings',
        settings: s.settings,
        reason: 'Conversation carried to a new provider session',
        handoff: true,
        previous: s.settings,
        handoffInfo: built.info,
      })
    return { resume: native, built }
  }

  launch(
    id: string,
    prompt: string,
    resume: string | null,
    recordUser = true,
    attachments: Attachment[] = [],
    from?: MessageOrigin,
  ): void {
    const s = this.host.get(id)
    const explicitGoal = !s.parentId && /^\/goal\s+(\S[\s\S]*)$/.exec(prompt.split('\n\n<ramu-context>')[0]!.trim())
    if (explicitGoal) this.host.setGoal(id, explicitGoal[1]!, true)
    const connection = this.host.toolConnection()?.(s)
    // Enabled Always rules are required: a launch that cannot hand them over stops with the reason, never drops them.
    let rulesText: string | undefined
    try {
      rulesText = this.host.rulesInstructions()?.(s)
      if (rulesText && !connection)
        throw new Error(
          'Your enabled rules cannot be delivered to this runtime. Turn them off in Settings → Agent setup → Rules to continue without them.',
        )
    } catch (e) {
      if (recordUser) this.host.record(id, userEvent(prompt, attachments, from))
      this.fail(id, e)
      return
    }
    const rulesUpdate = this.rulesUpdate(id, s.provider, rulesText, !!resume)
    // The conversation reaches a provider session that has not seen it: a switch, a lost session, a rewind. Built first so
    // the checkpoint goes out once, in the handoff, and not again in the session guidance.
    const carried = this.carry(id, resume, !!connection, prompt, attachments)
    if (carried === 'too-large') {
      if (recordUser) this.host.record(id, userEvent(prompt, attachments, from))
      this.fail(
        id,
        new Error(
          `The conversation is too large to carry to ${providerName(s.provider)} in one handoff. Start a new thread from a summary, or switch to a model with a larger context window.`,
        ),
      )
      return
    }
    // A delta that did not fit has no native session to resume: null means a fresh one, not "keep the old id".
    if (carried) resume = carried.resume
    this.host.clearContext(id)
    // With automatic goals off and no goal yet, the policy waits until /goal starts one.
    const pins = this.currentSettings(id)
    if (connection) this.launchPins.set(id, pins)
    const goalPolicy =
      !s.parentId && (pins.goalMode !== 'manual' || this.host.getGoal(id))
        ? goalInstructions({ ...this.host.goalPreferences(), mode: pins.goalMode }, this.host.getGoal(id))
        : null
    if (connection && goalPolicy) this.goalPolicySent.add(id)
    else this.goalPolicySent.delete(id)
    if (connection) {
      connection.instructions = sessionGuidance({
        questions: !usesRamuQuestionTools(pins.asyncQuestions, s)
          ? 'native'
          : pins.asyncQuestions
            ? 'async'
            : 'blocking',
        background: (this.host.preferences()?.autoBackgroundSeconds ?? 1) !== 0,
        advisor: pins.advisor,
        secrets: !s.parentId,
        goal: goalPolicy,
        nativeSubagentNote:
          // Antigravity's sub-agent tool cannot be switched off; Cursor's and OpenCode's are, at launch.
          s.provider === 'antigravity' && this.host.nativeSubagentsOff(s),
        memory: this.host.memoryInstructions()?.(s),
        toolSearch: usesRamuToolSearch(this.host.preferences()?.intelligence?.toolSearch !== false, s),
        nativeToolSearch: nativeToolSearch(s),
        learning: this.host.learningInstructions()?.(s, { checkpoint: !carried?.built.includesCheckpoint }),
        rules: rulesText,
        browser: connection.browserInstructions,
        noCredits: this.host.preferences()?.removeAgentCredits !== false,
      })
    }
    if (connection && this.host.nativeSubagentsOff(s)) connection.nativeSubagents = false
    if (connection && s.provider === 'claude-code' && this.host.claudeAdvisorModel(id) === '')
      connection.replaceAdvisor = true
    if (connection && s.provider === 'claude-code' && usesRamuQuestionTools(pins.asyncQuestions, s))
      connection.replaceQuestions = true
    if ((isAcpProvider(s.provider) || s.provider === 'claude-code') && connection && !s.parentId)
      this.nativeOffAtLaunch.set(id, connection.nativeSubagents === false)
    const request = explicitGoal ? prompt.replace(/^\s*\/goal\s+/, 'Work toward this Ramu goal: ') : prompt
    const actualPrompt = `${rulesUpdate ?? ''}${carried ? `${carried.built.prompt}\n\nNext request: ${request}` : request}`
    const deltaResume = carried?.built.info.mode === 'delta' && !!carried.resume
    // A read-only helper never writes, whatever the thread allows; its session records that it is one.
    const marker = this.host
      .events(id)
      .findLast((event) => event.kind === 'custom-agent' || event.kind === 'helper-role')
    const readOnly =
      (marker?.kind === 'custom-agent' && marker.readOnly) ||
      (marker?.kind === 'helper-role' && helperRoleReadOnly(marker.role))
    if (this.host.usesRunner(s.provider)) {
      let runner: AgentRunner
      try {
        runner = this.host.runnerFactory(s.provider)(
          s,
          s.settings,
          (event, limit) => {
            if (this.host.runners.get(id) !== runner) return
            if (event.kind === 'usage') {
              this.host.usage()?.update(event.readings)
              return
            }
            if (event.kind === 'title') {
              if (!s.parentId) this.host.providerTitle()?.(id, event.title)
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
                if (limit && event.isError) void this.host.fallback(id, limit === 'low' ? 'low' : 'high')
                else this.host.setState(id, event.isError ? 'failed' : 'idle')
              }
            }
          },
          readOnly,
        )
        if (connection) runner.setTools?.(connection)
        if (runner.setTerminals && providerAdapter(s.provider).native?.terminals) {
          const terminals = acpTerminalHostFor({ taskId: s.taskId, repoId: null, cwd: s.cwd })
          if (terminals) runner.setTerminals(terminals)
        }
        this.launchServers.set(id, this.serversNow(s, connection))
        this.host.runners.set(id, runner)
        if (recordUser) this.host.record(id, userEvent(prompt, attachments, from))
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
          // The main-thread boundary: a proven incompatible runtime fails here with its fix and the draft stays queued.
          if (launchCompatibility.applies(s.provider) && process.env.RAMU_FAKE_AGENT !== '1')
            await launchCompatibility.assertLaunchable(s.provider)
          if (this.host.runners.get(id) === runner)
            await asProcessOwner(id, () =>
              runner!.start(
                s.provider === 'codex' || s.provider === 'claude-code' || !connection?.instructions
                  ? actualPrompt
                  : `<ramu-session-guidance>\n${connection.instructions}\n</ramu-session-guidance>\n\n${actualPrompt}`,
                resume,
                attachments,
              ),
            )
        })().catch(async (e) => {
          if (this.host.runners.get(id) !== runner) return
          this.halt(id)
          // A runtime that cannot continue its saved session still gets the whole conversation, as when switching providers.
          // A returning provider's session is the one a delta resumes, so any start failure there gets the same fallback.
          // A blocked launch never retries as a lost session: it would only fail the same way.
          if (
            !(e instanceof ProviderIncompatibleError) &&
            !(e instanceof SessionInUse) &&
            (e instanceof ResumeUnavailable || deltaResume) &&
            resume &&
            !this.host.shutdown()
          ) {
            await this.host.draining.get(id)
            this.db.prepare('UPDATE agent_sessions SET provider_session_id = NULL WHERE id = ?').run(id)
            this.sessions.forget(id, s.provider, s.settings.accountId)
            this.host.record(id, {
              kind: 'settings',
              settings: s.settings,
              reason: `${providerName(s.provider)} could not resume its saved session — continuing from the conversation`,
              handoff: true,
              previous: s.settings,
              handoffInfo: { cause: 'resume-unavailable', mode: 'full', from: s.provider, fromSeq: 1 },
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
      restricted: connection?.restricted,
      readOnly,
    })
    const query = this.host.providerQuery({
      prompt: input,
      options: {
        ...claudeLaunchOptions({
          session: s,
          connection,
          advisorModel: this.host.claudeAdvisorModel(id),
          abort,
          canUseTool,
          resume,
          preferences: this.host.preferencesSource(),
          hooks: claudeHooks(
            !s.parentId && this.host.preferencesSource() ? this.host.subagentHooks(id) : undefined,
            !readOnly && !connection?.restricted ? alwaysAskHooks(s, s.settings.access) : undefined,
            readOnly ? readOnlyBashHooks() : undefined,
            ramuFileHooks(s),
          ),
        }),
        spawnClaudeCodeProcess: claudeSpawn(id),
        ...(readOnly ? { disallowedTools: [...READ_ONLY_DENIED, 'AskUserQuestion'] } : {}),
      },
    })
    this.host.live.set(id, { query, input, abort, pending })
    if (recordUser) this.host.record(id, userEvent(prompt, attachments, from))
    input.push(actualPrompt, attachments)
    this.host.setState(id, resume ? 'running' : 'starting')
    this.host.live.get(id)!.done = this.host.pump(id, query)
    this.host.refreshContext(id, query)
    this.host.usageReader.refresh(query, s.settings.accountId ?? 'default')
  }

  halt(id: string): void {
    this.host.cancelWaiters(id)
    const events = this.host.events(id)
    const outcomes = requestOutcomes(events)
    // Runner callbacks are ignored after detaching it below. Persist cancellation here so its prompts cannot survive it.
    for (const event of events)
      if (
        (event.kind === 'permission-request' ||
          event.kind === 'elicitation' ||
          (event.kind === 'question' && event.responseMode !== 'message')) &&
        (!event.requestSource || event.requestSource.sessionId === id) &&
        !outcomes.has(event.requestId)
      ) {
        this.host.record(id, { kind: 'request-resolved', requestId: event.requestId, outcome: 'cancelled' })
        outcomes.set(event.requestId, 'cancelled')
      }
    const codex = this.host.runners.get(id)
    this.nativeOffAtLaunch.delete(id)
    this.launchPins.delete(id)
    this.codexHookAtLaunch.delete(id)
    if (codex || this.host.live.has(id)) this.host.settleTasks(id)
    if (codex) {
      this.host.runners.delete(id)
      this.host.trackDrain(id, codex.stop())
      if (['starting', 'running', 'needs-input'].includes(this.host.get(id).state)) this.host.setState(id, 'stopped')
    }
    const live = this.host.live.get(id)
    if (!live) return
    for (const [requestId, p] of live.pending) {
      p.resolve({ behavior: 'deny', message: 'Session stopped by the user', interrupt: true })
      if (!outcomes.has(requestId)) this.host.record(id, { kind: 'request-resolved', requestId, outcome: 'cancelled' })
    }
    live.pending.clear()
    live.input.close()
    live.abort.abort()
    live.query.close?.()
    this.host.trackDrain(id, live.done ?? Promise.resolve())
    this.host.live.delete(id)
    if (['starting', 'running', 'needs-input'].includes(this.host.get(id).state)) this.host.setState(id, 'stopped')
  }

  stop(id: string): void {
    // A live provider process can remain attached after its turn finishes. Closing that process is cleanup,
    // not an interrupted turn, including during application shutdown.
    const interrupted =
      ['starting', 'running', 'needs-input'].includes(this.host.get(id).state) ||
      this.host.isRecoveryPending(id) ||
      this.host.transitioning.has(id) ||
      this.host.hasRunningTasks(id)
    if (!this.host.shutdown()) this.host.clearProviderWait(id)
    if (!this.host.shutdown() && this.host.getGoal(id) && this.host.getGoal(id)?.status !== 'completed')
      this.host.controlGoal(id, 'pause')
    if (!this.host.shutdown() && this.host.isRecoveryPending(id)) {
      this.db.prepare('DELETE FROM agent_recovery WHERE session_id = ?').run(id)
      this.host.setState(id, 'stopped')
    }
    this.host.cancelPendingStarts(id)
    // Bumped before its helpers stop, so a helper start that began earlier is cancelled as stale.
    this.host.revisions.set(id, (this.host.revisions.get(id) ?? 0) + 1)
    for (const [childId, run] of this.host.children) if (run.parentId === id) this.stop(childId)
    this.host.pauseQueue(id)
    this.halt(id)
    if (interrupted && !['failed', 'stopped'].includes(this.host.get(id).state)) this.host.setState(id, 'stopped')
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
    // A confident limit match holds the chat at the limit; a low-confidence one gets a single quiet retry first.
    const limit = classifyLimit(error, { channel: 'error' })
    if (limit && limit.confidence === 'low' && this.host.retryQuietly(id)) return
    if (limit && this.host.waitForGoalProvider(id)) return
    const goal = this.host.getGoal(id)
    if (goal?.status === 'active')
      this.host.saveGoal(id, { ...goal, status: 'blocked', reason: errorMessage(error), updatedAt: Date.now() })
    this.host.setState(id, 'failed')
  }
}
