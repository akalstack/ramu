// Structured agent service: the façade over the collaborators in ./agent/. Each owns one slice of the state (sessions,
// queue, goals, routing, sub-agents, ...); this class builds them, wires their hosts and exposes the public API.
import { mcpRequest, mcpServerDetails } from './agent/mcpStatus'
import { latestTasks } from '@ramu/shared/chat/agentTasks'
import { clipText } from '@ramu/shared/text'
import { providerName } from '@ramu/shared/providers/providers'
import { agentModelList, findModelByHandle, modelHandles } from '@ramu/shared/chat/modelChoice'
import { RequestReplay } from './agent/requestReplay'
import { customAgentFor, type CustomAgent } from '@ramu/shared/customAgents'
import type { ActivityRow } from '@ramu/shared/usageAcrossHosts'
import { PermissionApprovals } from './agent/permissionApprovals'
import {
  applyInlineUi,
  inlineUiActionMessage,
  latestSurfaces,
  type InlineUiActionEvent,
  type InlineUiResult,
} from '@ramu/shared/chat/inlineUi'
import { providerBinary } from './providers/providerBinaries'
import { DEFAULT_RUNNERS, sameRunnerForAll } from './providers/runners'
import type { AgentRunnerFactory, ProviderRunners } from './agent/agentRunner'
import type { Db } from './db'
import type {
  ContextUsage,
  AgentMcpStatus,
  McpSignIn,
  AgentModel,
  AppPreferences,
  AgentEvent,
  AgentScope,
  AgentSessionInfo,
  AgentSettings,
  AgentProvider,
  ProviderCatalog,
  McpConnection,
  SetupOmission,
  Schedule,
  StartedThread,
} from '@ramu/shared/types'
import type { UsageService } from './providers/usage'
import { loadHelperHistory, type HelperHistoryLoader } from './agent/helperHistory'
import { realGoalProbes, type GoalProbes } from './agent/goalProbes'
import type { QueryFn, SubagentResult } from './agent/types'
import { z } from 'zod'
import { SessionStore } from './agent/sessionStore'
import { readHelperSummaries } from './agent/helperSummaries'
import { markAdviceRead, readUnreadAdvice } from './agent/adviceUnread'
import { SessionRegistry } from './agent/sessionRegistry'
import { SessionRecorder } from './agent/sessionRecorder'
import { MessageDispatcher } from './agent/messageDispatcher'
import { GoalManager } from './agent/goalManager'
import { ProviderWaits } from './agent/providerWait'
import { UserRequests } from './agent/userRequests'
import { CatalogService } from './agent/catalogService'
import { FallbackRouter } from './agent/fallbackRouter'
import { BackgroundAnalysis } from './agent/backgroundAnalysis'
import { AdvisorService } from './agent/advisorService'
import { SubagentRunner } from './agent/subagentRunner'
import { AgentTasks } from './agent/agentTasks'
import { SessionProcess } from './agent/sessionProcess'
import { ClaudeStreamPump } from './agent/claudeStreamPump'
import { SessionStarter } from './agent/sessionStarter'
import { RestartRecovery } from './agent/restartRecovery'
import { ContextUsageTracker } from './agent/contextUsage'
import type { AgentHost, Collaborators } from './agent/hosts'

export type { QueryFn } from './agent/types'
export { stripRouterLine, cleanTitle, splitBranchLine } from './agent/text'
export { serverToolUse, serverToolResult } from './agent/toolSummaries'
export { conversationHandoff } from './agent/handoff'
export { claudeDefaultEffort, sameSettings } from './agent/settings'
export { isUsageLimit } from './agent/usageLimit'

/** No model signals yet; one object, so the catalog's classified result is reused. */
const NO_SIGNALS = {}
/**
 * Claude Code's MCP sign-in. The SDK's query runs it, though its declarations leave it out, so it is checked for before use.
 */
interface ClaudeMcpAuth {
  mcpAuthenticate(serverName: string): Promise<unknown>
  mcpSubmitOAuthCallbackUrl(serverName: string, callbackUrl: string): Promise<unknown>
}
function claudeMcpAuth(query: unknown): ClaudeMcpAuth | null {
  const candidate = query as Partial<ClaudeMcpAuth> | null | undefined
  return typeof candidate?.mcpAuthenticate === 'function' && typeof candidate.mcpSubmitOAuthCallbackUrl === 'function'
    ? (candidate as ClaudeMcpAuth)
    : null
}
const claudeSignIn = z
  .object({
    authUrl: z.string().url().optional(),
    callbackExpected: z.boolean().optional(),
    redirectScheme: z.string().optional(),
  })
  .passthrough()

/**
 * A helper's settings on a named model: the parent's own (access and fallback), on that model at its default effort.
 * A login or fast mode belongs to the parent's provider, so it carries over only to the same one.
 */
function helperSettings(
  base: AgentSettings,
  model: Pick<AgentModel, 'provider' | 'id' | 'defaultEffort'>,
): AgentSettings {
  const same = model.provider === base.provider
  return {
    ...base,
    provider: model.provider,
    model: model.id,
    effort: model.defaultEffort,
    serviceTier: same ? base.serviceTier : 'standard',
    accountId: same ? base.accountId : undefined,
  }
}

/** How long a branch switch waits for the threads in its checkout before giving up. */
const WRITERS_WAIT_MS = 30 * 60_000

export class AgentService {
  /** The collaborators that own the service's state; this class wires them together and exposes their public methods. */
  private readonly parts: Collaborators
  private shutdown = false
  helperHistory: HelperHistoryLoader = loadHelperHistory
  /** Receives a title a provider supplied for a top-level session; set by the server once thread titles exist. */
  providerTitle: ((sessionId: string, title: string) => void) | undefined
  /** How goals read git and run a verification command; replaceable so tests need no processes. */
  goalProbes: GoalProbes = realGoalProbes
  reviewHooks:
    | {
        begin(taskId: string, scope: AgentScope): Promise<string>
        bind(id: string, sessionId: string): void
        abandon(id: string, error: unknown): void
        followup(sessionId: string): Promise<void>
        complete?(sessionId: string): Promise<void>
        validateFeedback?(reviewId: string): Promise<void>
        /** Every tool call of a chat or its sub-agents, to tell apart threads writing in one checkout. */
        observe?(sessionId: string, event: AgentEvent): void
        /** Holds a command until no other thread's command runs in the checkout this chat shares. */
        commandTurn?(sessionId: string, toolUseId: string, signal?: AbortSignal): Promise<void>
      }
    | undefined
  toolConnection: ((session: AgentSessionInfo) => McpConnection) | undefined
  /** Shared-memory protocol and index for a session, the same for every provider. */
  memoryInstructions: ((session: AgentSessionInfo) => string) | undefined
  /** The user's always-on rules for a session's project and provider, labelled as the user's own. */
  rulesInstructions: ((session: AgentSessionInfo) => string | undefined) | undefined
  /** Shared MCP connections a login cannot use yet for a chat's project, checked when a chat moves onto it. */
  mcpDestination:
    | ((
        session: AgentSessionInfo,
        settings: AgentSessionInfo['settings'],
      ) => Promise<NonNullable<Extract<AgentEvent, { kind: 'settings' }>['mcpAttention']>>)
    | undefined
  /** What a destination provider login lacks from the thread's setup, for the settings event of a switch or fallback. */
  setupOmissions: ((session: AgentSessionInfo, settings: AgentSettings) => SetupOmission[]) | undefined
  /** What a helper starts without that its chat has from Shared MCP, in one sentence; null when nothing is left out. */
  helperSetupNote: ((helper: AgentSessionInfo) => string | null) | undefined
  /** Guidance from the learning job. `checkpoint: false` leaves the progress summary out, when a handoff already carries it. */
  learningInstructions: ((session: AgentSessionInfo, options?: { checkpoint?: boolean }) => string) | undefined
  sessionCheckpoint: ((id: string) => { seq: number; summary: string } | null) | undefined
  /** Plan usage per provider. Without it (tests) nothing switches early. */
  usage: (Pick<UsageService, 'list' | 'update'> & Partial<Pick<UsageService, 'all'>>) | undefined
  /** The saved app preferences: fallback chains, threshold and sub-agent routing. */
  preferences: (() => AppPreferences) | undefined
  /** Release and retirement dates from public model catalogs; set by the host, absent in tests. */
  modelSignals: (() => import('./providers/modelSignals').ModelSignals) | undefined
  /** New-model notices and tags; set by the host, absent in tests. */
  modelNews: import('./providers/modelNews').ModelNews | undefined
  /** Told when a chat's transcript is cut back, so clients drop the events from `seq` on. */
  onRewound: ((id: string, seq: number) => void) | undefined
  /** Told whenever a chat's context window usage changes. */
  onContext: ((id: string, context: ContextUsage) => void) | undefined
  /** Where sub-agents that work in their own copy of the checkout are given their worktrees. */
  isolationRoot: string | undefined
  /** Called before choosing another login, so its usage is current. */
  refreshAccountUsage: ((provider: AgentProvider) => Promise<void>) | undefined
  /** Logins known to run on an API key, as `provider:account`; set by the host, absent in tests. */
  apiKeyLogins: (() => ReadonlySet<string>) | undefined

  /** A bare factory serves every provider except Claude Code, which keeps the SDK loop. */
  private readonly runners: ProviderRunners
  /** Receives a title a provider session supplied on its own; set by the thread-title scheduler. */
  onProviderTitle?: (sessionId: string, title: string) => void

  private providerQuery: QueryFn = (args) =>
    this.queryFn({ ...args, options: { ...args.options, pathToClaudeCodeExecutable: providerBinary('claude-code') } })

  constructor(
    private readonly db: Db,
    private readonly onEvent: (sessionId: string, event: AgentEvent, seq?: number, revision?: number) => void,
    private readonly queryFn: QueryFn,
    runners: ProviderRunners | AgentRunnerFactory = DEFAULT_RUNNERS,
  ) {
    this.runners = typeof runners === 'function' ? sameRunnerForAll(runners) : runners
    // Collaborators reach each other (and the settings above) only through this one object.
    const parts = {} as Collaborators
    const host: AgentHost = {
      abortAdvice: (...a) => parts.advisor.abortAdvice(...a),
      get activeTools() {
        return parts.recorder.activeTools
      },
      claudeAdvisorModel: (...a) => parts.advisor.claudeAdvisorModel(...a),
      advisorStep: (...a) => parts.advisor.advisorStep(...a),
      get agentCalls() {
        return parts.pump.agentCalls
      },
      analyze: (...a) => this.analyze(...a),
      applyWaiting: (...a) => parts.router.applyWaiting(...a),
      autoResumeOf: (...a) => parts.providerWaits.autoResumeOf(...a),
      applySavedPermission: (...a) => parts.requests.applySavedPermission(...a),
      get attempted() {
        return parts.router.attempted
      },
      get attemptedAccounts() {
        return parts.router.attemptedAccounts
      },
      canSteer: (...a) => parts.dispatcher.canSteer(...a),
      cancelWaiters: (...a) => parts.requests.cancelWaiters(...a),
      get capturing() {
        return parts.dispatcher.capturing
      },
      cancelPendingStarts: (...a) => parts.subagents.cancelPendingStarts(...a),
      catalog: (...a) => this.catalog(...a),
      modelSignals: () => this.modelSignals?.() ?? NO_SIGNALS,
      modelNews: () => this.modelNews,
      get childRequests() {
        return parts.requests.childRequests
      },
      get children() {
        return parts.subagents.children
      },
      clearProviderWait: (...a) => parts.providerWaits.clearProviderWait(...a),
      continueNative: (...a) => parts.subagents.continueNative(...a),
      controlGoal: (...a) => parts.goals.controlGoal(...a),
      createSession: (...a) => parts.store.createSession(...a),
      dispatchQueued: (...a) => parts.dispatcher.dispatchQueued(...a),
      dispatchSteering: (...a) => parts.dispatcher.dispatchSteering(...a),
      get draining() {
        return parts.registry.draining
      },
      emit: (...a) => parts.store.emit(...a),
      events: (...a) => this.events(...a),
      latestEvent: (...a) => parts.store.latestEvent(...a),
      fail: (...a) => parts.process.fail(...a),
      fallback: (...a) => parts.router.fallback(...a),
      finalize: (...a) => parts.recorder.finalize(...a),
      get finalizing() {
        return parts.registry.finalizing
      },
      get: (...a) => this.get(...a),
      getGoal: (...a) => parts.goals.getGoal(...a),
      goalCommand: (...a) => parts.dispatcher.goalCommand(...a),
      goalPreferences: (...a) => parts.goals.goalPreferences(...a),
      get goalPolicySent() {
        return parts.process.goalPolicySent
      },
      halt: (...a) => parts.process.halt(...a),
      hasBlockingQuestions: (...a) => parts.requests.hasBlockingQuestions(...a),
      hasRunningTasks: (...a) => parts.store.hasRunningTasks(...a),
      hasNativeWork: (...a) => parts.store.hasNativeWork(...a),
      helperSummary: (...a) => parts.store.helperSummary(...a),
      helperHistory: () => this.helperHistory,
      goalProbes: () => this.goalProbes,
      isRecoveryPending: (...a) => parts.store.isRecoveryPending(...a),
      isolationRoot: () => this.isolationRoot,
      launch: (...a) => parts.process.launch(...a),
      learningInstructions: () => this.learningInstructions,
      list: (...a) => parts.store.list(...a),
      get live() {
        return parts.registry.live
      },
      memoryInstructions: () => this.memoryInstructions,
      rulesInstructions: () => this.rulesInstructions,
      mcpDestination: () => this.mcpDestination,
      setupOmissions: () => this.setupOmissions,
      helperSetupNote: () => this.helperSetupNote,
      mirrorChild: (...a) => parts.subagents.mirrorChild(...a),
      nativeSubagentsOff: (...a) => parts.subagents.nativeSubagentsOff(...a),
      noteRoute: (...a) => parts.router.noteRoute(...a),
      notifyWaiters: (...a) => parts.requests.notifyWaiters(...a),
      onContext: () => this.onContext,
      onEvent: (...a) => this.onEvent(...a),
      orderOf: (...a) => parts.router.orderOf(...a),
      otherAccount: (...a) => parts.router.otherAccount(...a),
      freshAccountUsage: (...a) => parts.router.freshAccountUsage(...a),
      pauseQueue: (...a) => parts.dispatcher.pauseQueue(...a),
      planSwitch: (...a) => parts.process.planSwitch(...a),
      planTransition: (...a) => parts.process.planTransition(...a),
      pendingBackground: (...a) => parts.registry.pendingBackground(...a),
      policyOf: (...a) => parts.router.policyOf(...a),
      launchSettings: (...a) => parts.process.launchSettings(...a),
      preferences: () => this.preferences?.(),
      preferencesSource: () => this.preferences,
      providerQuery: (args) => this.providerQuery(args),
      providerWait: (...a) => parts.providerWaits.providerWait(...a),
      pump: (...a) => parts.pump.pump(...a),
      questionStatus: (...a) => parts.requests.questionStatus(...a),
      queuePaused: (...a) => parts.store.queuePaused(...a),
      queued: (...a) => parts.store.queued(...a),
      threadDone: (...a) => parts.store.threadDone(...a),
      record: (...a) => parts.recorder.record(...a),
      refreshAccountUsage: () => this.refreshAccountUsage,
      apiKeyLogins: () => this.apiKeyLogins?.() ?? new Set<string>(),
      refreshContext: (...a) => parts.contexts.refreshContext(...a),
      rememberSession: (...a) => parts.process.rememberSession(...a),
      refreshProviderTools: (...a) => parts.process.refreshProviderTools(...a),
      rulesUpdate: (...a) => parts.process.rulesUpdate(...a),
      retryQuietly: (...a) => parts.router.retryQuietly(...a),
      get lowConfidenceRetried() {
        return parts.router.lowConfidenceRetried
      },
      reviewHooks: () => this.reviewHooks,
      get revisions() {
        return parts.registry.revisions
      },
      rootOf: (...a) => parts.store.rootOf(...a),
      route: (...a) => parts.router.route(...a),
      routing: (...a) => parts.router.routing(...a),
      runnerFactory: (provider) => this.runnerFactory(provider),
      usesRunner: (provider) => this.usesRunner(provider),
      get runners() {
        return parts.registry.runners
      },
      saveGoal: (...a) => parts.goals.saveGoal(...a),
      scheduleGoal: (...a) => parts.goals.scheduleGoal(...a),
      scheduleProvider: (...a) => parts.providerWaits.scheduleProvider(...a),
      send: (...a) => this.send(...a),
      sessionCheckpoint: () => this.sessionCheckpoint,
      context: (...a) => parts.contexts.context(...a),
      modelContextWindow: (...a) => parts.contexts.modelContextWindow(...a),
      rememberModelContext: (...a) => parts.contexts.rememberModelContext(...a),
      clearContext: (...a) => parts.contexts.clearContext(...a),
      noteRequest: (...a) => parts.contexts.noteRequest(...a),
      setContext: (...a) => parts.contexts.setContext(...a),
      setGoal: (...a) => parts.goals.setGoal(...a),
      setVerify: (...a) => parts.goals.setVerify(...a),
      setState: (...a) => parts.recorder.setState(...a),
      settleChild: (...a) => parts.subagents.settleChild(...a),
      settleTasks: (...a) => parts.tasks.settleTasks(...a),
      shutdown: () => this.shutdown,
      get startingSends() {
        return parts.dispatcher.startingSends
      },
      get steering() {
        return parts.dispatcher.steering
      },
      stop: (...a) => parts.process.stop(...a),
      stopAwaiting: (...a) => parts.tasks.stopAwaiting(...a),
      stopAndWait: (...a) => parts.process.stopAndWait(...a),
      subagentHooks: (...a) => parts.subagents.subagentHooks(...a),
      subagentSettings: (...a) => parts.router.subagentSettings(...a),
      submit: (...a) => parts.dispatcher.submit(...a),
      switchBeforeSend: (...a) => parts.router.switchBeforeSend(...a),
      syncTaskStatus: (...a) => parts.recorder.syncTaskStatus(...a),
      task: (...a) => parts.store.task(...a),
      titleContext: (...a) => parts.store.titleContext(...a),
      toolConnection: () => this.toolConnection,
      trackDrain: (...a) => parts.registry.trackDrain(...a),
      get transitioning() {
        return parts.registry.transitioning
      },
      updateQueue: (...a) => parts.dispatcher.updateQueue(...a),
      updateTask: (...a) => parts.tasks.updateTask(...a),
      usage: () => this.usage,
      providerTitle: () => this.providerTitle,
      get usageReader() {
        return parts.contexts.usageReader
      },
      // Through the service's own methods, so every boundary uses the one check a caller or test may replace.
      validateSettings: (...a) => this.validateSettings(...a),
      validateLaunch: (...a) => this.validateLaunch(...a),
      waitForGoalProvider: (...a) => parts.providerWaits.waitForGoalProvider(...a),
      wakeWorkspaceQueue: (...a) => parts.dispatcher.wakeWorkspaceQueue(...a),
      withStep: (...a) => parts.router.withStep(...a),
      workspaceBusy: (...a) => parts.dispatcher.workspaceBusy(...a),
      get workspaceQueue() {
        return parts.dispatcher.workspaceQueue
      },
      get workspaceReservations() {
        return parts.dispatcher.workspaceReservations
      },
    }
    parts.store = new SessionStore(host, this.db)
    parts.registry = new SessionRegistry(host)
    parts.recorder = new SessionRecorder(host, this.db)
    parts.dispatcher = new MessageDispatcher(host)
    parts.goals = new GoalManager(host, this.db)
    parts.providerWaits = new ProviderWaits(host, this.db)
    parts.requests = new UserRequests(host, this.db)
    parts.catalogs = new CatalogService(host)
    parts.router = new FallbackRouter(host, this.db)
    parts.analysis = new BackgroundAnalysis(host)
    parts.advisor = new AdvisorService(host)
    parts.subagents = new SubagentRunner(host)
    parts.tasks = new AgentTasks(host, this.db)
    parts.process = new SessionProcess(host, this.db)
    parts.pump = new ClaudeStreamPump(host, this.db)
    parts.starter = new SessionStarter(host, this.db)
    parts.recovery = new RestartRecovery(host, this.db)
    parts.contexts = new ContextUsageTracker(host, this.db)
    this.parts = parts
  }

  /** Model catalogs come from the installed providers, including their supported effort levels. */
  catalog(refresh = false): Promise<ProviderCatalog[]> {
    // Providers the user turned off disappear from pickers, routing and fallback.
    return this.discoverCatalog(refresh).then((catalogs) =>
      catalogs.filter((entry) => !this.parts.catalogs.providerOff(entry.provider)),
    )
  }

  private runnerFactory(provider: AgentProvider): AgentRunnerFactory {
    const factory = this.runners[provider]
    if (!factory) throw new Error(`${provider} has no thread runner`)
    return factory
  }

  /** Whether chats on this provider run through a runner instead of the Claude Agent SDK. */
  private usesRunner(provider: AgentProvider): boolean {
    return !!this.runners[provider]
  }

  async withWorkspaceReservation<T>(covers: string[], action: () => Promise<T>): Promise<T> {
    return this.parts.dispatcher.withWorkspaceReservation(covers, action)
  }

  /**
   * Lets the turns working in these checkouts finish while new ones wait, then runs `action` with the checkouts to
   * itself: for what rewrites a whole checkout, such as switching its branch.
   */
  async whenWritersFinish<T>(covers: string[], action: () => Promise<T>, limitMs = WRITERS_WAIT_MS): Promise<T> {
    const reservations = this.parts.dispatcher.workspaceReservations
    if (covers.some((cwd) => reservations.has(cwd))) throw new Error('Wait for the workspace operation to finish')
    covers.forEach((cwd) => reservations.add(cwd))
    try {
      const until = Date.now() + limitMs
      while (this.activeWriter(covers)) {
        if (Date.now() > until)
          throw new Error('The threads in this checkout are still working. Try again when they finish.')
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
      return await action()
    } finally {
      covers.forEach((cwd) => reservations.delete(cwd))
      this.parts.dispatcher.wakeWorkspaceQueue()
    }
  }

  interactivePublished(sessionId: string, reference: import('@ramu/shared/interactive').InteractiveReference): void {
    if (
      this.events(sessionId).some(
        (event) =>
          event.kind === 'interactive' &&
          event.reference.id === reference.id &&
          event.reference.version === reference.version,
      )
    )
      return
    this.record(sessionId, { kind: 'interactive', reference })
  }

  /** A drafted theme appears in the thread as a card; the person alone previews and keeps it. */
  themeProposed(sessionId: string, theme: import('@ramu/shared/theme').RamuTheme): void {
    this.record(sessionId, { kind: 'theme', theme })
  }

  /** Applies an agent's A2UI messages to the thread's inline cards, recording each changed card whole. */
  showInlineUi(sessionId: string, messages: unknown): InlineUiResult {
    const result = applyInlineUi(latestSurfaces(this.parts.store.eventsOfKind(sessionId, 'inline-ui')), messages)
    if (result.ok) for (const surface of result.surfaces) this.record(sessionId, { kind: 'inline-ui', surface })
    return result
  }

  /**
   * A button the person pressed on an inline card. The action must name a live card and one of its buttons, so a device
   * can only send what the agent offered; it reaches the agent as the person's message, like any other turn.
   */
  async inlineUiAction(sessionId: string, action: InlineUiActionEvent): Promise<void> {
    const surface = latestSurfaces(this.parts.store.eventsOfKind(sessionId, 'inline-ui')).get(action.surfaceId)
    if (!surface || surface.deleted) throw new Error('This card is no longer shown.')
    const button = surface.components.find((c) => c.id === action.sourceComponentId)
    if (button?.component !== 'Button' || !('event' in button.action) || button.action.event.name !== action.name)
      throw new Error('This card no longer offers that action.')
    if (action.dataModel && !surface.sendDataModel) throw new Error('This card does not send its values.')
    await this.submit(sessionId, inlineUiActionMessage(action), 'steer', [], undefined, true)
  }

  /** An ability call the thread's agent or the person made, shown as its own row with the result. */
  abilityCalled(sessionId: string, call: import('@ramu/shared/providers/abilities').AbilityCall): void {
    this.record(sessionId, { kind: 'ability', call })
  }

  scheduleSaved(sessionId: string, schedule: Schedule): void {
    this.record(sessionId, { kind: 'schedule', schedule })
  }

  /** The thread waits in line for a test device; its card shows the place and offers Stop waiting. */
  testDeviceWaiting(sessionId: string, platform: import('@ramu/shared/testDevices').TestPlatform): void {
    this.record(sessionId, { kind: 'test-device-wait', platform })
  }

  /** A card of pull request writes, shown where the agent asked for them. */
  pullRequestWritesShown(sessionId: string, cardId: string): void {
    this.record(sessionId, { kind: 'pull-request-writes', cardId })
  }

  /** A card of settings changes, shown where the agent asked for them. */
  settingsChangeShown(sessionId: string, cardId: string): void {
    this.record(sessionId, { kind: 'settings-change', cardId })
  }

  /** A tool suggested from what the thread did, shown where it was noticed. */
  toolSuggestionShown(sessionId: string, cardId: string): void {
    this.record(sessionId, { kind: 'tool-suggestion', cardId })
  }

  /** Threads this thread's agent started appear in it as one card that opens each of them. */
  threadsStarted(sessionId: string, threads: StartedThread[]): void {
    this.record(sessionId, { kind: 'threads-started', threads })
  }

  /** Preserve a person's stop in the conversation without sending a new request or waking the agent. */
  recordBackgroundTerminalStop(taskId: string, terminalId: string, command: string): void {
    for (const session of this.list(taskId)) {
      if (
        this.events(session.id).some(
          (event) => event.kind === 'background-terminal-stop' && event.terminalId === terminalId,
        )
      )
        continue
      this.record(session.id, { kind: 'background-terminal-stop', terminalId, command })
    }
  }

  /** Labels a thread's latest session; the original stays as it is and links to the thread on the other host. */
  recordContinued(taskId: string, event: Omit<Extract<AgentEvent, { kind: 'continued' }>, 'kind'>): void {
    const session = this.all()
      .filter((entry) => entry.taskId === taskId && !entry.parentId)
      .at(-1)
    if (!session) throw new Error('That thread has no agent.')
    this.record(session.id, { kind: 'continued', ...event })
  }

  recordFileRestore(id: string, userSeq: number, fileCount: number): void {
    this.record(id, { kind: 'file-restore', userSeq, fileCount })
  }

  recordCheckoutClash(id: string, path: string, taskId: string): void {
    this.record(id, { kind: 'checkout-clash', path, taskId })
  }

  recordCommandWait(id: string, taskId: string | null): void {
    this.record(id, { kind: 'command-wait', taskId })
  }

  stopAll(preserveRecovery = false): void {
    if (!preserveRecovery) this.db.prepare('DELETE FROM agent_recovery').run()
    this.shutdown = true
    this.parts.providerWaits.clearProviderTimers()
    this.parts.goals.clearGoalTimers()
    this.parts.analysis.cancelAnalyses()
    const { registry, store, dispatcher, process } = this.parts
    for (const id of new Set([...registry.live.keys(), ...registry.runners.keys()])) {
      const paused = store.queuePaused(id)
      process.stop(id)
      if (preserveRecovery) dispatcher.updateQueue(id, store.queued(id), paused)
    }
  }

  /** Independently running helpers per thread for list views, from one query. */
  helperSummaries(taskId?: string) {
    return readHelperSummaries(this.db, taskId)
  }

  /** Settled advisor consultations not yet seen, per thread, for list views, from one query. */
  unreadAdvice(taskId?: string) {
    return readUnreadAdvice(this.db, taskId)
  }

  /** The person has looked at this session's advice. */
  markAdviceRead(sessionId: string) {
    this.get(sessionId)
    markAdviceRead(this.db, sessionId)
  }

  /** The latest goal of a session for list views; cheap to call for every thread. */
  goalOf(...args: Parameters<GoalManager['goalOf']>) {
    return this.parts.goals.goalOf(...args)
  }

  getGoal(...args: Parameters<GoalManager['getGoal']>) {
    return this.parts.goals.getGoal(...args)
  }

  setGoal(...args: Parameters<GoalManager['setGoal']>) {
    return this.parts.goals.setGoal(...args)
  }

  setVerify(...args: Parameters<GoalManager['setVerify']>) {
    return this.parts.goals.setVerify(...args)
  }
  setGoalTurnLimit(...args: Parameters<GoalManager['setTurnLimit']>) {
    return this.parts.goals.setTurnLimit(...args)
  }

  updateGoal(...args: Parameters<GoalManager['updateGoal']>) {
    return this.parts.goals.updateGoal(...args)
  }

  controlGoal(...args: Parameters<GoalManager['controlGoal']>) {
    // The user resuming a goal that sits at a usage limit means "try now", also when auto-resume is off.
    if (args[1] === 'resume' && this.parts.providerWaits.providerWait(args[0]))
      this.parts.providerWaits.clearProviderWait(args[0])
    return this.parts.goals.controlGoal(...args)
  }

  /**
   * Re-arms what survives a restart or a settings change: goal timers, and every open usage-limit wait (retry timers turn
   * on or off with the effective auto-resume). Called at startup and from the settings-saved hook.
   */
  goalsSettingsChanged(...args: Parameters<GoalManager['goalsSettingsChanged']>) {
    this.parts.goals.goalsSettingsChanged(...args)
    this.parts.providerWaits.settingsChanged()
  }

  /** The open usage-limit wait of a thread, or null when it is not held at a limit. */
  providerWait(...args: Parameters<ProviderWaits['providerWait']>) {
    return this.parts.providerWaits.providerWait(...args)
  }

  /** Whether a thread at a usage limit continues by itself (its own choice, its parent's, else the global default). */
  autoResumeOf(...args: Parameters<ProviderWaits['autoResumeOf']>) {
    return this.parts.providerWaits.autoResumeOf(...args)
  }

  /** "Try again" for a thread at a usage limit; see `agent.retryLimitNow`. */
  retryLimitNow(...args: Parameters<ProviderWaits['retryLimitNow']>) {
    return this.parts.providerWaits.retryLimitNow(...args)
  }

  /** This thread's own auto-resume choice (null follows the global default); see `agent.setAutoResume`. */
  setAutoResume(...args: Parameters<ProviderWaits['setAutoResume']>) {
    return this.parts.providerWaits.setAutoResume(...args)
  }

  /** Shared timer spread for threads waiting on one limit; tests tighten it. */
  get waitSpread() {
    return this.parts.providerWaits.spread
  }

  /** The question and goal settings a chat's running process was launched with. */
  launchSettings(...args: Parameters<SessionProcess['launchSettings']>) {
    return this.parts.process.launchSettings(...args)
  }

  questionStatus(...args: Parameters<UserRequests['questionStatus']>) {
    return this.parts.requests.questionStatus(...args)
  }

  askQuestion(...args: Parameters<UserRequests['askQuestion']>) {
    return this.parts.requests.askQuestion(...args)
  }
  requestPermission(...args: Parameters<UserRequests['requestPermission']>) {
    return this.parts.requests.requestPermission(...args)
  }

  createProjectIn(...args: Parameters<UserRequests['createProjectIn']>) {
    return this.parts.requests.createProjectIn(...args)
  }

  requestSecret(...args: Parameters<UserRequests['requestSecret']>) {
    return this.parts.requests.requestSecret(...args)
  }

  pendingSecret(...args: Parameters<UserRequests['pendingSecret']>) {
    return this.parts.requests.pendingSecret(...args)
  }

  answerSecret(...args: Parameters<UserRequests['answerSecret']>) {
    return this.parts.requests.answerSecret(...args)
  }

  /** Where answered secrets are written for the agents' commands. */
  set secretFiles(files: import('./agent/secretFiles').SecretFiles) {
    this.parts.requests.secretFiles = files
  }

  /** Runs a thread's project's migrations against production before any production deploy goes out. */
  set shipDeploys(ship: UserRequests['shipDeploys']) {
    this.parts.requests.shipDeploys = ship
  }
  set beforeProduction(run: UserRequests['beforeProduction']) {
    this.parts.requests.beforeProduction = run
  }

  approveProductionDeploy(...args: Parameters<UserRequests['approveProductionDeploy']>) {
    return this.parts.requests.approveProductionDeploy(...args)
  }

  waitForAnswer(...args: Parameters<UserRequests['waitForAnswer']>) {
    return this.parts.requests.waitForAnswer(...args)
  }

  saveQuestionDraft(...args: Parameters<UserRequests['saveQuestionDraft']>) {
    return this.parts.requests.saveQuestionDraft(...args)
  }

  closeQuestion(...args: Parameters<UserRequests['closeQuestion']>) {
    return this.parts.requests.closeQuestion(...args)
  }

  context(...args: Parameters<ContextUsageTracker['context']>) {
    return this.parts.contexts.context(...args)
  }

  claudeAccountUsage(...args: Parameters<ContextUsageTracker['claudeAccountUsage']>) {
    return this.parts.contexts.claudeAccountUsage(...args)
  }

  invalidateCatalog(...args: Parameters<CatalogService['invalidateCatalog']>) {
    return this.parts.catalogs.invalidateCatalog(...args)
  }

  markRestoredOnBoot(...args: Parameters<RestartRecovery['markRestoredOnBoot']>) {
    return this.parts.recovery.markRestoredOnBoot(...args)
  }

  prepareForRestart(...args: Parameters<RestartRecovery['prepareForRestart']>) {
    return this.parts.recovery.prepareForRestart(...args)
  }

  isRecoveryPending(...args: Parameters<SessionStore['isRecoveryPending']>) {
    return this.parts.store.isRecoveryPending(...args)
  }

  /** Startup: restore helper transcripts, resume interrupted chats, then re-arm goals and limit waits. `index.ts` calls only this. */
  async recoverOnBoot(): Promise<void> {
    await this.restoreHelperTranscripts()
    await this.resumeInterruptedChats()
    this.goalsSettingsChanged()
  }

  restoreHelperTranscripts(...args: Parameters<RestartRecovery['restoreHelperTranscripts']>) {
    return this.parts.recovery.restoreHelperTranscripts(...args)
  }

  resumeInterruptedChats(...args: Parameters<RestartRecovery['resumeInterruptedChats']>) {
    return this.parts.recovery.resumeInterruptedChats(...args)
  }

  counts(...args: Parameters<SessionStore['counts']>) {
    return this.parts.store.counts(...args)
  }

  list(...args: Parameters<SessionStore['list']>) {
    return this.parts.store.list(...args)
  }

  all() {
    const sessions = this.parts.store.all()
    const byId = new Map(sessions.map((session) => [session.id, session]))
    const native = this.db
      .prepare("SELECT session_id, event FROM agent_events WHERE json_extract(event,'$.kind')='agent' ORDER BY seq")
      .all() as { session_id: string; event: string }[]
    const byParent = new Map<string, AgentEvent[]>()
    for (const row of native) {
      const events = byParent.get(row.session_id) ?? []
      events.push(JSON.parse(row.event) as AgentEvent)
      byParent.set(row.session_id, events)
    }
    const rows: AgentSessionInfo[] = []
    for (const { parentId, task } of [...byParent].flatMap(([parentId, events]) =>
      latestTasks(events).map((task) => ({ parentId, task })),
    )) {
      const parent = byId.get(parentId)
      const child = byId.get(task.childSessionId ?? task.agentId)
      if (
        !parent ||
        parent.parentId ||
        child?.parentId === parent.id ||
        task.taskType === 'local_bash' ||
        task.taskType === 'advisor'
      )
        continue
      const live = this.parts.registry.live.has(parent.id) || this.parts.registry.runners.has(parent.id)
      const running =
        task.status === 'running' &&
        !task.recovered &&
        (['running', 'starting', 'needs-input'].includes(parent.state) ||
          (parent.state === 'idle' && task.background && live))
      rows.push({
        ...parent,
        id: `native:${parent.id}:${task.agentId}`,
        parentId: parent.id,
        title: task.name,
        provider: task.provider ?? parent.provider,
        settings: { ...parent.settings, model: task.model ?? parent.settings.model },
        state: running
          ? 'running'
          : task.status === 'failed'
            ? 'failed'
            : task.status === 'stopped'
              ? 'stopped'
              : 'idle',
        pendingInput: false,
        inputSummary: null,
        waitingUntil: null,
        nativeTask: task,
      })
    }
    return [...sessions, ...rows]
  }

  get(...args: Parameters<SessionStore['get']>) {
    return this.parts.store.get(...args)
  }
  /** A repository the task's project gained inside a folder its threads already work in joins what they cover. */
  coverRepository(taskId: string, root: string): void {
    this.parts.store.cover(taskId, root)
  }

  searchMessages(...args: Parameters<SessionStore['searchMessages']>) {
    return this.parts.store.searchMessages(...args)
  }

  tail(...args: Parameters<SessionStore['tail']>) {
    return this.parts.store.tail(...args)
  }

  providerUses() {
    return this.parts.store.providerUses()
  }

  listByTask() {
    return this.parts.store.listByTask()
  }

  /**
   * A thread marked done takes no automatic next turn: its queued messages and an active goal pause, and wait for the
   * person to continue it.
   */
  holdThread(taskId: string): void {
    for (const session of this.listByTask().get(taskId) ?? []) {
      // A done thread waits on nothing: a usage-limit wait would resume it at the reset, and keeps its tray showing.
      this.parts.providerWaits.clearProviderWait(session.id)
      this.parts.dispatcher.pauseQueue(session.id)
      if (this.getGoal(session.id)?.status === 'active') this.controlGoal(session.id, 'pause')
    }
  }

  changes(...args: Parameters<SessionStore['changes']>) {
    return this.parts.store.changes(...args)
  }

  events(...args: Parameters<SessionStore['events']>) {
    return this.parts.store.events(...args)
  }

  activeWriter(...args: Parameters<SessionRegistry['activeWriter']>) {
    return this.parts.registry.activeWriter(...args)
  }

  writing(...args: Parameters<SessionRegistry['writing']>) {
    return this.parts.registry.writing(...args)
  }

  rootOf(...args: Parameters<SessionStore['rootOf']>) {
    return this.parts.store.rootOf(...args)
  }

  startReviewed(...args: Parameters<SessionStarter['startReviewed']>) {
    return this.parts.starter.startReviewed(...args)
  }

  start(...args: Parameters<SessionStarter['start']>) {
    return this.parts.starter.start(...args)
  }

  send(...args: Parameters<SessionStarter['send']>) {
    return this.parts.starter.send(...args)
  }

  queued(...args: Parameters<SessionStore['queued']>) {
    return this.parts.store.queued(...args)
  }

  queuePaused(...args: Parameters<SessionStore['queuePaused']>) {
    return this.parts.store.queuePaused(...args)
  }

  removeQueued(...args: Parameters<MessageDispatcher['removeQueued']>) {
    return this.parts.dispatcher.removeQueued(...args)
  }

  holdQueued(...args: Parameters<MessageDispatcher['holdQueued']>) {
    return this.parts.dispatcher.holdQueued(...args)
  }

  editQueued(...args: Parameters<MessageDispatcher['editQueued']>) {
    return this.parts.dispatcher.editQueued(...args)
  }

  reorderQueued(...args: Parameters<MessageDispatcher['reorderQueued']>) {
    return this.parts.dispatcher.reorderQueued(...args)
  }

  sendQueuedNow(...args: Parameters<MessageDispatcher['sendQueuedNow']>) {
    return this.parts.dispatcher.sendQueuedNow(...args)
  }

  resumeQueue(...args: Parameters<MessageDispatcher['resumeQueue']>) {
    return this.parts.dispatcher.resumeQueue(...args)
  }

  submit(...args: Parameters<MessageDispatcher['submit']>) {
    return this.parts.dispatcher.submit(...args)
  }

  enqueueBackground(...args: Parameters<MessageDispatcher['enqueueBackground']>) {
    return this.parts.dispatcher.enqueueBackground(...args)
  }

  wakeBackground(...args: Parameters<MessageDispatcher['wakeBackground']>) {
    return this.parts.dispatcher.wakeBackground(...args)
  }

  validateSettings(...args: Parameters<CatalogService['validateSettings']>) {
    return this.parts.catalogs.validateSettings(...args)
  }

  validateLaunch(...args: Parameters<CatalogService['validateLaunch']>) {
    return this.parts.catalogs.validateLaunch(...args)
  }

  configure(...args: Parameters<FallbackRouter['configure']>) {
    return this.parts.router.configure(...args)
  }

  draftCommit(...args: Parameters<BackgroundAnalysis['draftCommit']>) {
    return this.parts.analysis.draftCommit(...args)
  }

  draftPullRequest(...args: Parameters<BackgroundAnalysis['draftPullRequest']>) {
    return this.parts.analysis.draftPullRequest(...args)
  }

  continuationPrompt(...args: Parameters<BackgroundAnalysis['continuationPrompt']>) {
    return this.parts.analysis.continuationPrompt(...args)
  }

  /** Live provider state, or the last startup snapshot when the thread has no active Claude process. */
  async mcpStatus(id: string): Promise<AgentMcpStatus> {
    this.get(id)
    const runner = this.parts.registry.runners.get(id)
    if (runner?.mcpStatus) {
      const status = await mcpRequest(runner.mcpStatus())
      if (this.parts.registry.runners.get(id) !== runner) throw new Error('The provider changed. Refresh MCP status.')
      return { ...status, servers: mcpServerDetails(status.servers) }
    }
    const query = this.parts.registry.live.get(id)?.query
    if (query?.mcpServerStatus) {
      const servers = mcpServerDetails(await mcpRequest(query.mcpServerStatus()))
      if (this.parts.registry.live.get(id)?.query !== query)
        throw new Error('The provider changed. Refresh MCP status.')
      return {
        supported: true,
        live: true,
        source: 'live',
        canReconnect: true,
        canAuthenticate: !!claudeMcpAuth(query),
        servers,
      }
    }
    const init = this.events(id).findLast((event) => event.kind === 'init')
    return {
      supported: true,
      live: false,
      source: 'snapshot',
      servers: init?.kind === 'init' ? (init.mcpServers ?? []) : [],
    }
  }

  async reconnectMcp(id: string, name: string): Promise<void> {
    const session = this.get(id)
    const runner = this.parts.registry.runners.get(id)
    if (runner?.reconnectMcp) {
      const status = await mcpRequest(runner.mcpStatus!())
      if (this.parts.registry.runners.get(id) !== runner) throw new Error('The provider changed. Refresh MCP status.')
      if (!status.canReconnect || !status.servers.some((server) => server.name === name))
        throw new Error('Unknown or unsupported MCP server')
      await mcpRequest(runner.reconnectMcp(name), 70_000)
      return
    }
    const query = this.parts.registry.live.get(id)?.query
    if (session.provider !== 'claude-code' || !query?.reconnectMcpServer)
      throw new Error('Reconnect is available while a Claude session is active. Send a message to start it.')
    const servers = await mcpRequest(query.mcpServerStatus())
    if (this.parts.registry.live.get(id)?.query !== query) throw new Error('The provider changed. Refresh MCP status.')
    if (!servers.some((server) => server.name === name)) throw new Error('Unknown MCP server')
    await mcpRequest(query.reconnectMcpServer(name), 70_000)
  }

  async signInMcp(id: string, name: string): Promise<McpSignIn> {
    const session = this.get(id)
    const runner = this.parts.registry.runners.get(id)
    if (runner?.signInMcp) return mcpRequest(runner.signInMcp(name), 70_000)
    const query = this.parts.registry.live.get(id)?.query
    const auth = session.provider === 'claude-code' ? claudeMcpAuth(query) : null
    if (!auth) throw new Error('Signing in is available while the thread is running. Send a message to start it.')
    const answer = claudeSignIn.safeParse(await mcpRequest(auth.mcpAuthenticate(name), 70_000))
    if (!answer.success) throw new Error('The provider answered the sign-in in a shape Ramu does not know.')
    const { authUrl, callbackExpected, redirectScheme } = answer.data
    return { ...(authUrl ? { authUrl } : {}), returnsToHost: !!callbackExpected && redirectScheme === 'localhost' }
  }

  async finishMcpSignIn(id: string, name: string, callbackUrl: string): Promise<void> {
    const session = this.get(id)
    const auth = session.provider === 'claude-code' ? claudeMcpAuth(this.parts.registry.live.get(id)?.query) : null
    if (!auth) throw new Error('This provider finishes the sign-in by itself.')
    await mcpRequest(auth.mcpSubmitOAuthCallbackUrl(name, callbackUrl), 70_000)
  }

  async reloadMcp(id: string): Promise<void> {
    this.get(id)
    const runner = this.parts.registry.runners.get(id)
    if (!runner?.reloadMcp) throw new Error('This provider does not support reloading MCP servers in an active thread.')
    await mcpRequest(runner.reloadMcp(), 70_000)
  }

  holdProvider(...args: Parameters<FallbackRouter['holdProvider']>) {
    return this.parts.router.holdProvider(...args)
  }

  nextRoute(...args: Parameters<FallbackRouter['nextRoute']>) {
    return this.parts.router.nextRoute(...args)
  }

  providerHold(...args: Parameters<FallbackRouter['providerHold']>) {
    return this.parts.router.providerHold(...args)
  }

  forkAnswer(...args: Parameters<BackgroundAnalysis['forkAnswer']>) {
    return this.parts.analysis.forkAnswer(...args)
  }

  asideContext(...args: Parameters<BackgroundAnalysis['asideContext']>) {
    return this.parts.analysis.asideContext(...args)
  }

  advisorStep(...args: Parameters<AdvisorService['advisorStep']>) {
    return this.parts.advisor.advisorStep(...args)
  }

  consultAdvisor(...args: Parameters<AdvisorService['consultAdvisor']>) {
    return this.parts.advisor.consultAdvisor(...args)
  }

  waitForAdvice(...args: Parameters<AdvisorService['waitForAdvice']>) {
    return this.parts.advisor.waitForAdvice(...args)
  }

  draftTitle(...args: Parameters<BackgroundAnalysis['draftTitle']>) {
    return this.parts.analysis.draftTitle(...args)
  }

  draftTitleResult(...args: Parameters<BackgroundAnalysis['draftTitleResult']>) {
    return this.parts.analysis.draftTitleResult(...args)
  }

  analyze(...args: Parameters<BackgroundAnalysis['analyze']>) {
    return this.parts.analysis.analyze(...args)
  }

  withStep(...args: Parameters<FallbackRouter['withStep']>) {
    return this.parts.router.withStep(...args)
  }

  route(...args: Parameters<FallbackRouter['route']>) {
    return this.parts.router.route(...args)
  }

  subagentSettings(...args: Parameters<FallbackRouter['subagentSettings']>) {
    return this.parts.router.subagentSettings(...args)
  }

  /** Finished turns per local day and provider since `since`, with cost and tokens where the provider reported them. */
  activity(since: number): ActivityRow[] {
    // Ability calls count under the provider that ran them, not the thread's own.
    return this.db
      .prepare(
        `SELECT day, provider, COUNT(*) AS turns, COALESCE(SUM(cost), 0) AS costUsd, SUM(cost IS NULL) AS unpriced,
           COALESCE(SUM(tokens), 0) AS tokens, SUM(tokens IS NULL) AS untokened
         FROM (
           SELECT date(json_extract(e.event, '$.at') / 1000, 'unixepoch', 'localtime') AS day, s.provider AS provider,
             json_extract(e.event, '$.costUsd') AS cost,
             json_extract(e.event, '$.tokens.input') + json_extract(e.event, '$.tokens.output') AS tokens
           FROM agent_events e JOIN agent_sessions s ON s.id = e.session_id
           WHERE json_extract(e.event, '$.kind') = 'result' AND json_extract(e.event, '$.at') >= ?
           UNION ALL
           SELECT date(json_extract(e.event, '$.at') / 1000, 'unixepoch', 'localtime'),
             json_extract(e.event, '$.call.provider'), NULL,
             json_extract(e.event, '$.call.tokens.input') + json_extract(e.event, '$.call.tokens.output')
           FROM agent_events e
           WHERE json_extract(e.event, '$.kind') = 'ability' AND json_extract(e.event, '$.call.status') = 'done'
             AND json_extract(e.event, '$.call.provider') != 'ramu' AND json_extract(e.event, '$.at') >= ?
         )
         GROUP BY day, provider ORDER BY day`,
      )
      .all(since, since) as unknown as ActivityRow[]
  }

  /** Custom agents the lead may use; set by the host, so tests and a bare service run without any. */
  customAgents: () => readonly CustomAgent[] = () => []

  /** The host's abilities: what each provider offers, and the model for a helper that needs some. Set by the host. */
  abilities?: {
    listing(): import('@ramu/shared/providers/abilities').AbilityListing
    helperModel(needs: readonly import('@ramu/shared/providers/abilities').Ability[]): Promise<AgentModel>
    has(provider: AgentProvider, needs: readonly import('@ramu/shared/providers/abilities').Ability[]): boolean
  }

  /** A model the agent named by handle or id, or an error listing the handles it can use. */
  private async modelNamed(handle: string): Promise<AgentModel> {
    const models = (await this.catalog()).flatMap((catalog) => catalog.models)
    const model = findModelByHandle(models, handle)
    if (!model) throw new Error(`Name a model from: ${modelHandles(models).join(', ')}. agent_models lists them.`)
    return model
  }

  /** agent_models: the host's providers and their current models, so the agent stops guessing handles. */
  async agentModels(query?: string) {
    const providers = agentModelList(await this.catalog(), query)
    return this.abilities ? { providers, abilities: this.abilities.listing() } : { providers }
  }

  /** ramu_agent_status: the caller's own helpers, or one of them. */
  helperStatus(parentId: string, agentId?: string) {
    const helpers = latestTasks(this.events(parentId)).filter(
      (task) => task.taskType === 'ramu_agent' && (!agentId || task.agentId === agentId),
    )
    if (agentId && !helpers.length) throw new Error('That is not one of your helpers.')
    return helpers.map((task) => ({
      agent: task.agentId,
      name: task.name,
      status: task.status,
      ...(task.waitingFor ? { waitingFor: task.waitingFor } : {}),
      ...(task.role ? { role: task.role } : {}),
      ...(task.provider ? { provider: task.provider, model: task.model } : {}),
      ...(task.isolated ? { isolated: true } : {}),
      ...(task.startedAt ? { startedAt: task.startedAt } : {}),
      ...(task.endedAt ? { endedAt: task.endedAt } : {}),
      ...(task.summary ? { summary: clipText(task.summary, 2000) } : {}),
    }))
  }

  /** ramu_agent_stop: a lead stops one of its own helpers that went off track. Stopping the thread still stops them all. */
  async stopHelper(parentId: string, agentId: string): Promise<{ stopped: boolean; status: string }> {
    const [task] = this.helperStatus(parentId, agentId)
    if (task!.status !== 'running') return { stopped: false, status: task!.status }
    await this.stopTask(parentId, agentId)
    return { stopped: true, status: 'stopped' }
  }

  private readonly helperStarts = new RequestReplay<SubagentResult>()

  spawnSubagent(...args: Parameters<SubagentRunner['spawnSubagent']>) {
    const [parentId, input, ...rest] = args
    if (!input.requestId) return this.startHelper(parentId, input, ...rest)
    const { requestId, ...once } = input
    return this.helperStarts.run(`${parentId}:${requestId}`, () => this.startHelper(parentId, once, ...rest))
  }

  private async startHelper(...args: Parameters<SubagentRunner['spawnSubagent']>) {
    const [parentId, asked, ...rest] = args
    let input = asked
    if (input.needs?.length && !input.settings) {
      if (!this.abilities) throw new Error('This host cannot choose a helper by ability.')
      const parent = this.get(parentId)
      if (input.model) {
        const named = await this.modelNamed(input.model)
        if (!this.abilities.has(named.provider, input.needs))
          throw new Error(
            `${providerName(named.provider)} does not have every ability this helper needs here. Leave out model and Ramu picks a provider that does.`,
          )
        input = { ...input, settings: helperSettings(parent.settings, named) }
      } else
        input = { ...input, settings: helperSettings(parent.settings, await this.abilities.helperModel(input.needs)) }
    }
    if (input.model && !input.settings) {
      const parent = this.get(parentId)
      // The parent's settings on the named model, so the helper keeps the parent's access and never gets more.
      input = { ...input, settings: helperSettings(parent.settings, await this.modelNamed(input.model)) }
    }
    const custom = input.custom ?? customAgentFor(this.customAgents(), input.type)
    if (custom && !input.custom) {
      const parent = this.get(parentId)
      // A custom agent wins over a sub-agent type rule or a provider's own agent of the same name.
      return this.parts.subagents.spawnSubagent(
        parentId,
        {
          ...input,
          type: undefined,
          name: input.name || custom.name,
          custom,
          ...(custom.model && !input.settings
            ? { settings: { ...parent.settings, ...custom.model, effort: custom.model.effort ?? null } }
            : {}),
        },
        ...rest,
      )
    }
    return this.parts.subagents.spawnSubagent(parentId, input, ...rest)
  }

  messageParent(...args: Parameters<SubagentRunner['messageParent']>) {
    return this.parts.subagents.messageParent(...args)
  }

  askParent(...args: Parameters<SubagentRunner['askParent']>) {
    return this.parts.subagents.askParent(...args)
  }

  answerSubagent(...args: Parameters<SubagentRunner['answerSubagent']>) {
    return this.parts.subagents.answerSubagent(...args)
  }

  codexSpawnDecision(...args: Parameters<SubagentRunner['codexSpawnDecision']>) {
    return this.parts.subagents.codexSpawnDecision(...args)
  }

  task(...args: Parameters<SessionStore['task']>) {
    return this.parts.store.task(...args)
  }

  backgroundTool(...args: Parameters<AgentTasks['backgroundTool']>) {
    return this.parts.tasks.backgroundTool(...args)
  }

  awaitCommands(...args: Parameters<AgentTasks['awaitCommands']>) {
    return this.parts.tasks.awaitCommands(...args)
  }

  stopTask(...args: Parameters<AgentTasks['stopTask']>) {
    return this.parts.tasks.stopTask(...args)
  }

  messageTask(...args: Parameters<AgentTasks['messageTask']>) {
    return this.parts.tasks.messageTask(...args)
  }

  /** The person writes to a helper. */
  async messageFromPerson(sessionId: string, agentId: string, text: string) {
    await this.parts.tasks.messageTask(sessionId, agentId, text)
  }

  interrupt(...args: Parameters<SessionProcess['interrupt']>) {
    return this.parts.process.interrupt(...args)
  }

  stop(...args: Parameters<SessionProcess['stop']>) {
    return this.parts.process.stop(...args)
  }

  /**
   * Rewinds a chat to just before one of your messages, as if it was never sent: the chat stops, that message and
   * everything after it are removed, and the provider's saved session is dropped. The next message starts a fresh
   * provider session that is handed the remaining conversation, the same way a provider switch carries it over, so
   * this works for every provider. Files are left alone; restoring them is a separate step.
   */
  async rewind(id: string, userSeq: number): Promise<void> {
    const s = this.get(id)
    if (s.parentId) throw new Error('Helper threads cannot be rewound. Edit a message in the main thread.')
    const row = this.db.prepare('SELECT event FROM agent_events WHERE session_id = ? AND seq = ?').get(id, userSeq) as
      { event: string } | undefined
    const event = row ? (JSON.parse(row.event) as AgentEvent) : null
    if (event?.kind !== 'user' || event.agentId) throw new Error('That message is no longer in this thread.')
    await this.stopAndWait(id)
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM agent_events WHERE session_id = ? AND seq >= ?').run(id, userSeq)
      this.parts.goals.forgetGoal(id)
      this.db.prepare('UPDATE agent_sessions SET provider_session_id = NULL WHERE id = ?').run(id)
      // Native sessions of other providers still remember the removed turns, so none of them may be resumed.
      this.db.prepare('DELETE FROM session_provider_sessions WHERE session_id = ?').run(id)
      // A progress summary that covers removed turns would bring them back.
      this.db
        .prepare("DELETE FROM session_checkpoints WHERE session_id = ? AND json_extract(data, '$.seq') >= ?")
        .run(id, userSeq)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    this.onRewound?.(id, userSeq)
    this.record(id, {
      kind: 'settings',
      settings: s.settings,
      reason: 'Rewound to before an edited message — the next message continues from the conversation above',
      handoff: true,
      previous: s.settings,
      handoffInfo: { cause: 'rewind', mode: 'full', from: s.provider, fromSeq: 1 },
    })
  }

  /**
   * Moves a thread's main session into another working folder, as when a No project thread becomes the new project's
   * thread. A provider's saved session belongs to the folder it ran in, so none is resumed: the next message starts a
   * fresh provider session that is handed the conversation, as after a rewind, which works the same for every provider.
   */
  async relocate(id: string, scope: AgentScope, reason: string): Promise<void> {
    const s = this.get(id)
    if (s.parentId) throw new Error('Helper threads work in their parent thread’s folder.')
    if (['starting', 'running', 'needs-input'].includes(s.state))
      throw new Error('Wait for the current turn to finish before moving this thread.')
    const paused = this.queuePaused(id)
    await this.stopAndWait(id)
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare(
          'UPDATE agent_sessions SET cwd = ?, additional_dirs = ?, covers = ?, provider_session_id = NULL WHERE id = ?',
        )
        .run(scope.cwd, JSON.stringify(scope.additionalDirs), JSON.stringify(scope.covers), id)
      this.db.prepare('DELETE FROM session_provider_sessions WHERE session_id = ?').run(id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    this.record(id, {
      kind: 'settings',
      settings: s.settings,
      reason,
      handoff: true,
      previous: s.settings,
      handoffInfo: { cause: 'move', mode: 'full', from: s.provider, fromSeq: 1 },
    })
    // Stopping holds queued messages; a move is not a stop, so they go on to the new folder.
    if (!paused && this.queuePaused(id)) this.resumeQueue(id)
  }

  stopAndWait(...args: Parameters<SessionProcess['stopAndWait']>) {
    return this.parts.process.stopAndWait(...args)
  }

  listPermissionApprovals() {
    return new PermissionApprovals(this.db).listSaved()
  }

  removePermissionApproval(id: string): void {
    new PermissionApprovals(this.db).removeSaved(id)
  }

  clearPermissionApprovals(removal?: import('@ramu/shared/types').PermissionRemoval): void {
    new PermissionApprovals(this.db).clear(removal, { includeBuiltins: false })
  }

  forgetPermission(...args: Parameters<UserRequests['forgetPermission']>) {
    return this.parts.requests.forgetPermission(...args)
  }

  replyPermission(...args: Parameters<UserRequests['replyPermission']>) {
    return this.parts.requests.replyPermission(...args)
  }

  saveElicitationDraft(...args: Parameters<UserRequests['saveElicitationDraft']>) {
    return this.parts.requests.saveElicitationDraft(...args)
  }

  replyElicitation(...args: Parameters<UserRequests['replyElicitation']>) {
    return this.parts.requests.replyElicitation(...args)
  }

  replyQuestion(...args: Parameters<UserRequests['replyQuestion']>) {
    return this.parts.requests.replyQuestion(...args)
  }

  private record(...args: Parameters<SessionRecorder['record']>) {
    return this.parts.recorder.record(...args)
  }

  private updateQueue(...args: Parameters<MessageDispatcher['updateQueue']>) {
    return this.parts.dispatcher.updateQueue(...args)
  }

  /** A helper that runs elsewhere (on another host): its card in the parent, updated as its progress arrives. */
  recordHelperTask(parentId: string, agentId: string, patch: Partial<import('@ramu/shared/types').AgentTask>): void {
    this.updateTask(parentId, agentId, { ...patch, taskType: 'ramu_agent' })
  }

  private updateTask(...args: Parameters<AgentTasks['updateTask']>) {
    return this.parts.tasks.updateTask(...args)
  }

  private dispatchSteering(...args: Parameters<MessageDispatcher['dispatchSteering']>) {
    return this.parts.dispatcher.dispatchSteering(...args)
  }

  private dispatchQueued(...args: Parameters<MessageDispatcher['dispatchQueued']>) {
    return this.parts.dispatcher.dispatchQueued(...args)
  }

  private createSession(...args: Parameters<SessionStore['createSession']>) {
    return this.parts.store.createSession(...args)
  }

  private subagentHooks(...args: Parameters<SubagentRunner['subagentHooks']>) {
    return this.parts.subagents.subagentHooks(...args)
  }

  private discoverCatalog(...args: Parameters<CatalogService['discoverCatalog']>) {
    return this.parts.catalogs.discoverCatalog(...args)
  }
}
