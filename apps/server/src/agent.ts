// Structured agent service: the façade over the collaborators in ./agent/. Each owns one slice of the state (sessions,
// queue, goals, routing, sub-agents, ...); this class builds them, wires their hosts and exposes the public API.
import { providerBinary } from './providers/providerBinaries'
import { createAcpRunner } from './providers/acp'
import type { AgentRunnerFactory } from './agent/agentRunner'
import type { Db } from './db'
import type {
  ContextUsage,
  AppPreferences,
  AgentEvent,
  AgentScope,
  AgentSessionInfo,
  AgentProvider,
  ProviderCatalog,
  McpConnection,
  Schedule,
} from '@ramu/shared/types'
import type { UsageService } from './providers/usage'
import { loadHelperHistory, type HelperHistoryLoader } from './agent/helperHistory'
import type { QueryFn } from './agent/types'
import { SessionStore } from './agent/sessionStore'
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

export class AgentService {
  /** The collaborators that own the service's state; this class wires them together and exposes their public methods. */
  private readonly parts: Collaborators
  private shutdown = false
  helperHistory: HelperHistoryLoader = loadHelperHistory
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
  learningInstructions: ((session: AgentSessionInfo) => string) | undefined
  sessionCheckpoint: ((id: string) => { seq: number; summary: string } | null) | undefined
  /** Plan usage per provider. Without it (tests) nothing switches early. */
  usage: (Pick<UsageService, 'list' | 'update'> & Partial<Pick<UsageService, 'all'>>) | undefined
  /** The saved app preferences: fallback chains, threshold and sub-agent routing. */
  preferences: (() => AppPreferences) | undefined
  /** Told whenever a chat's context window usage changes. */
  onContext: ((id: string, context: ContextUsage) => void) | undefined
  /** Where sub-agents that work in their own copy of the checkout are given their worktrees. */
  isolationRoot: string | undefined
  /** Called before choosing another login, so its usage is current. */
  refreshAccountUsage: ((provider: AgentProvider) => Promise<void>) | undefined

  private providerQuery: QueryFn = (args) =>
    this.queryFn({ ...args, options: { ...args.options, pathToClaudeCodeExecutable: providerBinary('claude-code') } })

  constructor(
    private readonly db: Db,
    private readonly onEvent: (sessionId: string, event: AgentEvent, seq?: number, revision?: number) => void,
    private readonly queryFn: QueryFn,
    private readonly codexFactory: AgentRunnerFactory = createAcpRunner,
    private readonly acpFactory: AgentRunnerFactory = createAcpRunner,
    private readonly openCodeFactory: AgentRunnerFactory = createAcpRunner,
    /** When set, Claude chats run through this ACP runner; without it they use the Claude Agent SDK directly. */
    private readonly claudeFactory?: AgentRunnerFactory,
  ) {
    // Collaborators reach each other (and the settings above) only through this one object.
    const parts = {} as Collaborators
    const host: AgentHost = {
      abortAdvice: (...a) => parts.advisor.abortAdvice(...a),
      get activeTools() {
        return parts.recorder.activeTools
      },
      activeWriter: (...a) => parts.registry.activeWriter(...a),
      advisorOn: (...a) => parts.advisor.advisorOn(...a),
      advisorStep: (...a) => parts.advisor.advisorStep(...a),
      get agentCalls() {
        return parts.pump.agentCalls
      },
      analyze: (...a) => this.analyze(...a),
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
      catalog: (...a) => this.catalog(...a),
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
      halt: (...a) => parts.process.halt(...a),
      hasBlockingQuestions: (...a) => parts.requests.hasBlockingQuestions(...a),
      hasRunningTasks: (...a) => parts.store.hasRunningTasks(...a),
      helperHistory: () => this.helperHistory,
      isRecoveryPending: (...a) => parts.store.isRecoveryPending(...a),
      isolationRoot: () => this.isolationRoot,
      launch: (...a) => parts.process.launch(...a),
      learningInstructions: () => this.learningInstructions,
      list: (...a) => parts.store.list(...a),
      get live() {
        return parts.registry.live
      },
      memoryInstructions: () => this.memoryInstructions,
      mirrorChild: (...a) => parts.subagents.mirrorChild(...a),
      nativeSubagentsOff: (...a) => parts.subagents.nativeSubagentsOff(...a),
      noteRoute: (...a) => parts.router.noteRoute(...a),
      notifyWaiters: (...a) => parts.requests.notifyWaiters(...a),
      onContext: () => this.onContext,
      onEvent: (...a) => this.onEvent(...a),
      orderOf: (...a) => parts.router.orderOf(...a),
      pauseQueue: (...a) => parts.dispatcher.pauseQueue(...a),
      pendingBackground: (...a) => parts.registry.pendingBackground(...a),
      policyOf: (...a) => parts.router.policyOf(...a),
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
      refreshProviderTools: (...a) => parts.process.refreshProviderTools(...a),
      responseStyleInstructions: (...a) => parts.process.responseStyleInstructions(...a),
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
      setContext: (...a) => parts.contexts.setContext(...a),
      setGoal: (...a) => parts.goals.setGoal(...a),
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
      toolConnection: () => this.toolConnection,
      trackDrain: (...a) => parts.registry.trackDrain(...a),
      get transitioning() {
        return parts.registry.transitioning
      },
      updateQueue: (...a) => parts.dispatcher.updateQueue(...a),
      updateTask: (...a) => parts.tasks.updateTask(...a),
      usage: () => this.usage,
      get usageReader() {
        return parts.contexts.usageReader
      },
      validateSettings: (...a) => parts.catalogs.validateSettings(...a),
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
    parts.providerWaits = new ProviderWaits(host)
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
    parts.contexts = new ContextUsageTracker(host)
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
    return provider === 'codex'
      ? this.codexFactory
      : provider === 'opencode'
        ? this.openCodeFactory
        : provider === 'claude-code'
          ? this.claudeFactory!
          : this.acpFactory
  }

  /** Whether chats on this provider run through a runner instead of the Claude Agent SDK. */
  private usesRunner(provider: AgentProvider): boolean {
    return provider !== 'claude-code' || !!this.claudeFactory
  }

  async withWorkspaceReservation<T>(covers: string[], action: () => Promise<T>): Promise<T> {
    return this.parts.dispatcher.withWorkspaceReservation(covers, action)
  }

  scheduleSaved(sessionId: string, schedule: Schedule): void {
    this.record(sessionId, { kind: 'schedule', schedule })
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

  getGoal(...args: Parameters<GoalManager['getGoal']>) {
    return this.parts.goals.getGoal(...args)
  }

  setGoal(...args: Parameters<GoalManager['setGoal']>) {
    return this.parts.goals.setGoal(...args)
  }

  updateGoal(...args: Parameters<GoalManager['updateGoal']>) {
    return this.parts.goals.updateGoal(...args)
  }

  controlGoal(...args: Parameters<GoalManager['controlGoal']>) {
    return this.parts.goals.controlGoal(...args)
  }

  goalsSettingsChanged(...args: Parameters<GoalManager['goalsSettingsChanged']>) {
    return this.parts.goals.goalsSettingsChanged(...args)
  }

  questionStatus(...args: Parameters<UserRequests['questionStatus']>) {
    return this.parts.requests.questionStatus(...args)
  }

  askQuestion(...args: Parameters<UserRequests['askQuestion']>) {
    return this.parts.requests.askQuestion(...args)
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

  get(...args: Parameters<SessionStore['get']>) {
    return this.parts.store.get(...args)
  }

  searchMessages(...args: Parameters<SessionStore['searchMessages']>) {
    return this.parts.store.searchMessages(...args)
  }

  snapshot(...args: Parameters<SessionStore['snapshot']>) {
    return this.parts.store.snapshot(...args)
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

  removeQueued(...args: Parameters<MessageDispatcher['removeQueued']>) {
    return this.parts.dispatcher.removeQueued(...args)
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

  validateSettings(...args: Parameters<CatalogService['validateSettings']>) {
    return this.parts.catalogs.validateSettings(...args)
  }

  configure(...args: Parameters<FallbackRouter['configure']>) {
    return this.parts.router.configure(...args)
  }

  draftCommit(...args: Parameters<BackgroundAnalysis['draftCommit']>) {
    return this.parts.analysis.draftCommit(...args)
  }

  continuationPrompt(...args: Parameters<BackgroundAnalysis['continuationPrompt']>) {
    return this.parts.analysis.continuationPrompt(...args)
  }

  holdProvider(...args: Parameters<FallbackRouter['holdProvider']>) {
    return this.parts.router.holdProvider(...args)
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

  spawnSubagent(...args: Parameters<SubagentRunner['spawnSubagent']>) {
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

  stopAndWait(...args: Parameters<SessionProcess['stopAndWait']>) {
    return this.parts.process.stopAndWait(...args)
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
