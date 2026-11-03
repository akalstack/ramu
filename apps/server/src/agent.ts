// Structured agent service: the façade over the collaborators in ./agent/. Each owns one slice of the state (sessions,
// queue, goals, routing, sub-agents, ...); this class builds them, wires their hosts and exposes the public API.
import { mcpRequest, mcpServerDetails } from './agent/mcpStatus'
import {
  activeTeammates,
  latestTasks,
  leadNotePrompt,
  leadQuestionPrompt,
  namesTeammate,
  teammateHandle,
} from '@ramu/shared/chat/agentTasks'
import { clipText } from '@ramu/shared/text'
import { customAgentFor, type CustomAgent } from '@ramu/shared/customAgents'
import type { ActivityRow } from '@ramu/shared/usageAcrossHosts'
import { PermissionApprovals } from './agent/permissionApprovals'
import { providerBinary } from './providers/providerBinaries'
import { DEFAULT_RUNNERS, sameRunnerForAll } from './providers/runners'
import type { AgentRunnerFactory, ProviderRunners } from './agent/agentRunner'
import type { Db } from './db'
import type {
  ContextUsage,
  AgentMcpStatus,
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
  TeammateMode,
} from '@ramu/shared/types'
import type { UsageService } from './providers/usage'
import { loadHelperHistory, type HelperHistoryLoader } from './agent/helperHistory'
import { realGoalProbes, type GoalProbes } from './agent/goalProbes'
import type { QueryFn } from './agent/types'
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
import { SubagentRunner, TEAMMATE_PAUSED } from './agent/subagentRunner'
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

/** Teammates one thread holds at once; each is a model the person pays for. */
const MAX_TEAMMATES = 4

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
  /** Told when a chat's transcript is cut back, so clients drop the events from `seq` on. */
  onRewound: ((id: string, seq: number) => void) | undefined
  /** Told whenever a chat's context window usage changes. */
  onContext: ((id: string, context: ContextUsage) => void) | undefined
  /** Where sub-agents that work in their own copy of the checkout are given their worktrees. */
  isolationRoot: string | undefined
  /** Called before choosing another login, so its usage is current. */
  refreshAccountUsage: ((provider: AgentProvider) => Promise<void>) | undefined

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
      activeWriter: (...a) => parts.registry.activeWriter(...a),
      claudeAdvisorModel: (...a) => parts.advisor.claudeAdvisorModel(...a),
      advisorStep: (...a) => parts.advisor.advisorStep(...a),
      get agentCalls() {
        return parts.pump.agentCalls
      },
      analyze: (...a) => this.analyze(...a),
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
      get childRequests() {
        return parts.requests.childRequests
      },
      get children() {
        return parts.subagents.children
      },
      clearProviderWait: (...a) => parts.providerWaits.clearProviderWait(...a),
      continueNative: (...a) => parts.subagents.continueNative(...a),
      wakeTeammate: (...a) => parts.subagents.wakeTeammate(...a),
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
      record: (...a) => parts.recorder.record(...a),
      refreshAccountUsage: () => this.refreshAccountUsage,
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

  scheduleSaved(sessionId: string, schedule: Schedule): void {
    this.record(sessionId, { kind: 'schedule', schedule })
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

  readClaudeUsage(...args: Parameters<ContextUsageTracker['readClaudeUsage']>) {
    return this.parts.contexts.readClaudeUsage(...args)
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

  searchMessages(...args: Parameters<SessionStore['searchMessages']>) {
    return this.parts.store.searchMessages(...args)
  }

  tail(...args: Parameters<SessionStore['tail']>) {
    return this.parts.store.tail(...args)
  }

  listByTask() {
    return this.parts.store.listByTask()
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
      return { supported: true, live: true, source: 'live', canReconnect: true, servers }
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

  /**
   * Brings a model the person chose into this thread as a teammate, named as the model menu names it (numbered when the
   * same model is already here). A thread holds up to four.
   */
  async addTeammate(sessionId: string, settings: AgentSettings, mode: TeammateMode, request: string) {
    const lead = this.get(sessionId)
    if (lead.parentId) throw new Error('Add a teammate to the main thread, not to a helper.')
    const here = activeTeammates(latestTasks(this.events(sessionId)))
    if (here.length >= MAX_TEAMMATES)
      throw new Error(`This thread already has ${MAX_TEAMMATES} teammates. Stop one before adding another.`)
    // Review never writes, whatever the thread allows; Take over cannot exceed the thread's own access.
    const access = mode === 'review' ? 'edits' : lead.settings.access
    const listed = (await this.catalog().catch(() => []))
      .flatMap((catalog) => catalog.models)
      .find((model) => model.provider === settings.provider && model.id === settings.model)
    const base = clipText(listed?.name || settings.model || settings.provider, 60)
    const taken = new Set(here.map((task) => teammateHandle(task.name)))
    let name = base
    for (let n = 2; taken.has(teammateHandle(name)); n++) name = `${base} ${n}`
    return this.parts.subagents.spawnSubagent(sessionId, {
      description: 'Teammate',
      prompt:
        request.trim() ||
        (mode === 'review'
          ? 'Review what the lead has done so far and reply with your findings.'
          : 'Take over the latest request and hand back when done.'),
      background: true,
      name,
      settings: { ...settings, access },
      teammate: mode,
    })
  }

  /**
   * teammate_message: the lead and its teammate address each other by name. The lead's note wakes the teammate, whose
   * next report comes back; the teammate's note reaches the lead at once. Both count toward the pause for the person.
   */
  async teammateMessage(fromId: string, to: string, text: string): Promise<{ to: string }> {
    if (this.get(fromId).parentId) {
      await this.parts.subagents.messageLead(fromId, to, text)
      return { to: 'lead' }
    }
    const here = activeTeammates(latestTasks(this.events(fromId)))
    if (!here.length) throw new Error('This thread has no teammate. The person adds one with @ or the thread menu.')
    const named = here.filter((task) => namesTeammate(to, task.name))
    const teammate = named.length === 1 ? named[0]! : null
    if (!teammate)
      throw new Error(`Name one teammate: ${here.map((task) => `"${teammateHandle(task.name)}"`).join(', ')}.`)
    if (this.parts.subagents.teammatePaused(fromId)) throw new Error(TEAMMATE_PAUSED)
    await this.parts.tasks.messageTask(fromId, teammate.agentId, leadNotePrompt(text))
    return { to: teammateHandle(teammate.name) }
  }

  /** teammate_ask: the lead asks one teammate by name and gets its reply as the tool's result. */
  async teammateAsk(fromId: string, to: string, question: string, signal?: AbortSignal): Promise<{ reply: string }> {
    if (this.get(fromId).parentId) throw new Error('Only the main agent asks teammates; use teammate_message.')
    const here = activeTeammates(latestTasks(this.events(fromId)))
    if (!here.length) throw new Error('This thread has no teammate. The person adds one with @ or the thread menu.')
    const named = here.filter((task) => namesTeammate(to, task.name))
    if (named.length !== 1)
      throw new Error(`Name one teammate: ${here.map((task) => `"${teammateHandle(task.name)}"`).join(', ')}.`)
    const teammate = named[0]!
    const reply = await this.parts.subagents.askTeammate(
      fromId,
      teammate.agentId,
      () => this.parts.tasks.messageTask(fromId, teammate.agentId, leadQuestionPrompt(question)),
      signal,
    )
    return { reply }
  }

  /** The person wrote, so a teammate exchange that paused may continue. */
  resetTeammateRounds(sessionId: string) {
    this.parts.subagents.resetTeammateRounds(sessionId)
  }

  /** Finished turns per local day and provider since `since`, with cost and tokens where the provider reported them. */
  activity(since: number): ActivityRow[] {
    return this.db
      .prepare(
        `SELECT date(json_extract(e.event, '$.at') / 1000, 'unixepoch', 'localtime') AS day, s.provider AS provider,
           COUNT(*) AS turns, COALESCE(SUM(json_extract(e.event, '$.costUsd')), 0) AS costUsd,
           SUM(json_extract(e.event, '$.costUsd') IS NULL) AS unpriced,
           COALESCE(SUM(json_extract(e.event, '$.tokens.input') + json_extract(e.event, '$.tokens.output')), 0) AS tokens,
           SUM(json_extract(e.event, '$.tokens') IS NULL) AS untokened
         FROM agent_events e JOIN agent_sessions s ON s.id = e.session_id
         WHERE json_extract(e.event, '$.kind') = 'result' AND json_extract(e.event, '$.at') >= ?
         GROUP BY day, s.provider ORDER BY day`,
      )
      .all(since) as unknown as ActivityRow[]
  }

  /** Custom agents the lead may use; set by the host, so tests and a bare service run without any. */
  customAgents: () => readonly CustomAgent[] = () => []

  spawnSubagent(...args: Parameters<SubagentRunner['spawnSubagent']>) {
    const [parentId, input, ...rest] = args
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
          ...(custom.model
            ? { settings: { ...parent.settings, ...custom.model, effort: custom.model.effort ?? null } }
            : {}),
        },
        ...rest,
      )
    }
    return this.parts.subagents.spawnSubagent(...args)
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

  stopTask(...args: Parameters<AgentTasks['stopTask']>) {
    return this.parts.tasks.stopTask(...args)
  }

  messageTask(...args: Parameters<AgentTasks['messageTask']>) {
    return this.parts.tasks.messageTask(...args)
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
