import type { z } from 'zod'
import type { FileContext, SkillInfo, AppPreferences, ModelPreferences } from '@ramu/shared/types'
import type { NoticeInbox } from '../background/notices'
import type { ActivityService } from '../background/activity'
import type { LearningService } from '../memory/learning'
import type { ProviderService } from '../providers/providers'
import type { KeepAwakeService } from '../background/keepAwake'
import type { AppUpdateService } from '../background/appUpdates'
import type { UsageService } from '../providers/usage'
import type { ExtraUsageReader } from '../providers/providerUsage'
import type { AccountUsage } from '../providers/accountUsage'
import type { ProviderEnvironmentStore } from '../providers/environmentStore'
import type { ForgeAccountStore } from '../workspace/forgeAccounts'
import type { BitbucketCredentials } from '../workspace/forge/bitbucketCredentials'
import type { AzureCredentials } from '../workspace/forge/azureCredentials'
import type { GitlabCredentials } from '../workspace/forge/gitlabCredentials'
import type { AttachmentStore } from '../attachments'
import type { HostFolders } from '../remote/hostFolders'
import type { AgentService } from '../agent'
import type { TerminalService } from '../workspace/pty'
import type { Workspace } from '../workspace/workspace'
import type { ScheduleService } from '../background/schedules'
import type { PullRequestWatchService } from '../background/pullRequestWatches'
import type { ReviewService } from '../review/reviews'
import type { RecapService } from '../memory/recaps'
import type { MemoryService } from '../memory/memory'
import type { SummaryService } from '../memory/summaries'
import type { RuleStore } from '../rules/rules'
import type { KeyedLock } from './keyedLock'
import type { FileWatchers } from './watchers'

export interface Services {
  computer?: import('../computer/service').ComputerService
  computerVideo?: import('../computer/rtc').RtcViewers
  hostBrowser?: import('../browser/hostBrowser').HostBrowser
  browser?: import('../browser/desktopBroker').DesktopBrowserBroker
  getSharedMcp?: () => import('../mcp/service').SharedMcpService
  threadTitles?: import('../agent/threadTitles').ThreadTitles
  interactive?: import('../interactive/store').InteractiveStore
  diagnostics?: import('../background/diagnostics').LocalDiagnostics
  externalSkills?: import('../memory/externalSkills').ExternalSkills
  workspace: Workspace
  terminals: TerminalService
  resources?: import('../background/resources').ResourceService
  customAgents?: import('../agent/customAgents').CustomAgentStore
  testDevices?: import('../testDevice/testDevices').TestDevices
  agents: AgentService
  schedules: ScheduleService
  pullRequestWatches?: PullRequestWatchService
  pullRequestIndex?: import('../background/pullRequestIndex').PullRequestIndex
  pullRequestDrafts?: import('../background/pullRequestDrafts').PullRequestDrafts
  recaps: RecapService
  learning?: LearningService
  memory?: MemoryService
  summaries?: SummaryService
  agentThreads?: import('../background/agentThreads').AgentThreadService
  rules?: RuleStore
  reviews: ReviewService
  notices?: NoticeInbox
}
export interface RuntimeHost {
  browserDevice?(): string | undefined
  browserGrantEligible?(deviceId: string): boolean
  userData: string
  /** Initial integration/credential administration is local to the execution host. */
  canAdministerIntegrations?(): boolean
  send(channel: string, payload: unknown): void
  native(method: 'pickExecutable' | 'pickDirectory' | 'pickAttachments' | 'reveal', path?: string): Promise<unknown>
  /** This host's own desktop app, when it is open: whether it is, and asking it to install a prepared update. */
  desktopApp?: { attached(): boolean; installUpdate(version: string): Promise<void> }
  /** Stops the service so its service manager starts the newly built version. */
  restartService?(): void
}

/** One RPC method: a validated argument tuple and the function that runs with it. */
export interface Method {
  args: z.ZodType<unknown[]>
  // Each handler declares its own parameter types; the dispatcher only ever calls it with the parsed tuple.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (...args: any[]) => unknown
}
export type MethodTable = Record<string, Method>

/** Everything a handler group needs: the injected services plus the runtime pieces built once per dispatcher. */
export interface HandlerContext extends Services {
  host: RuntimeHost
  lock: KeyedLock
  watchers: FileWatchers
  hostFolders: HostFolders
  activity: ActivityService
  providers: ProviderService
  awake: KeepAwakeService
  attachmentStore: AttachmentStore
  updates: AppUpdateService
  hostUpdates: import('../background/hostUpdate').HostUpdater
  usage: UsageService
  extraUsage: ExtraUsageReader
  accountUsage: AccountUsage
  environment: ProviderEnvironmentStore
  apiKeys: import('../providers/apiKeyStore').ProviderApiKeyStore
  forgeAccounts: ForgeAccountStore
  bitbucket: BitbucketCredentials
  azure: AzureCredentials
  gitlab: GitlabCredentials
  loadPreferences(): AppPreferences
  savePreferences(preferences: AppPreferences, models?: ModelPreferences): void
  /** The stored preferences as written, without defaults or validation. */
  storedPreferences(): Partial<AppPreferences>
  managedSkills(taskId: string): SkillInfo[]
  withContext(ws: Workspace, taskId: string, prompt: string, context?: FileContext[]): Promise<string>
  cwdOf(taskId: string, repoId: string): string
  gitCwdOf(taskId: string, repoId: string): string
}

/** A handler group: given the shared context, returns its slice of the method table. */
export type RegisterHandlers = (ctx: HandlerContext) => MethodTable
