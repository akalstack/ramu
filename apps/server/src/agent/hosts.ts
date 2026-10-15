import type { SessionStore, SessionStoreHost } from './sessionStore'
import type { SessionRegistry, SessionRegistryHost } from './sessionRegistry'
import type { SessionRecorder, SessionRecorderHost } from './sessionRecorder'
import type { MessageDispatcher, MessageDispatcherHost } from './messageDispatcher'
import type { GoalManager, GoalManagerHost } from './goalManager'
import type { ProviderWaits, ProviderWaitsHost } from './providerWait'
import type { UserRequests, UserRequestsHost } from './userRequests'
import type { CatalogService, CatalogServiceHost } from './catalogService'
import type { FallbackRouter, FallbackRouterHost } from './fallbackRouter'
import type { BackgroundAnalysis, BackgroundAnalysisHost } from './backgroundAnalysis'
import type { AdvisorService, AdvisorServiceHost } from './advisorService'
import type { SubagentRunner, SubagentRunnerHost } from './subagentRunner'
import type { AgentTasks, AgentTasksHost } from './agentTasks'
import type { SessionProcess, SessionProcessHost } from './sessionProcess'
import type { ClaudeStreamPump, ClaudeStreamPumpHost } from './claudeStreamPump'
import type { SessionStarter, SessionStarterHost } from './sessionStarter'
import type { RestartRecovery, RestartRecoveryHost } from './restartRecovery'
import type { ContextUsageTracker, ContextUsageTrackerHost } from './contextUsage'

/** Every collaborator's host in one type: the service builds one object that satisfies all of them. */
export type AgentHost = SessionStoreHost &
  SessionRegistryHost &
  SessionRecorderHost &
  MessageDispatcherHost &
  GoalManagerHost &
  ProviderWaitsHost &
  UserRequestsHost &
  CatalogServiceHost &
  FallbackRouterHost &
  BackgroundAnalysisHost &
  AdvisorServiceHost &
  SubagentRunnerHost &
  AgentTasksHost &
  SessionProcessHost &
  ClaudeStreamPumpHost &
  SessionStarterHost &
  RestartRecoveryHost &
  ContextUsageTrackerHost

/** The collaborators, by the name the service and their hosts know them by. */
export interface Collaborators {
  store: SessionStore
  registry: SessionRegistry
  recorder: SessionRecorder
  dispatcher: MessageDispatcher
  goals: GoalManager
  providerWaits: ProviderWaits
  requests: UserRequests
  catalogs: CatalogService
  router: FallbackRouter
  analysis: BackgroundAnalysis
  advisor: AdvisorService
  subagents: SubagentRunner
  tasks: AgentTasks
  process: SessionProcess
  pump: ClaudeStreamPump
  starter: SessionStarter
  recovery: RestartRecovery
  contexts: ContextUsageTracker
}
