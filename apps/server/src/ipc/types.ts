import type { z } from 'zod'
import type { FileContext, SkillInfo, AppPreferences, ModelPreferences } from '@ramu/shared/types'
import type { InstalledApp } from '@ramu/shared/updates'
import type { NoticeInbox } from '../background/notices'
import type { ActivityService } from '../background/activity'
import type { LearningService } from '../memory/learning'
import type { ProviderService } from '../providers/providers'
import type { KeepAwakeService } from '../background/keepAwake'
import type { AppUpdateService } from '../background/appUpdates'
import type { UsageService } from '../providers/usage'
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
import type { MemoryService } from '../memory/memory'
import type { SummaryService } from '../memory/summaries'
import type { RuleStore } from '../rules/rules'
import type { RuleFiles } from '../rules/ruleFiles'
import type { KeyedLock } from './keyedLock'
import type { FileWatchers } from './watchers'

export interface Services {
  computer?: import('../computer/service').ComputerService
  computerVideo?: import('../computer/rtc').RtcViewers
  hostBrowser?: import('../browser/hostBrowser').HostBrowser
  browser?: import('../browser/desktopBroker').DesktopBrowserBroker
  getSharedMcp?: () => import('../mcp/service').SharedMcpService
  /** Installed plugins, their credentials and the indexes they are listed in. */
  plugins?: import('../plugins/service').PluginService
  /** Work, personal and client identities, and which one each project acts as. */
  identities?: import('../identities/service').IdentityService
  /** The optional Ramu account: sign-in, sealed settings backups and Your hosts. */
  account?: import('../account/service').AccountService
  threadTitles?: import('../agent/threadTitles').ThreadTitles
  interactive?: import('../interactive/store').InteractiveStore
  pages?: import('../interactive/pages').PageStore
  liveDashboards?: import('../interactive/liveDashboard').LiveDashboards
  /** Which named services each kept dashboard may read. */
  serviceGrants?: import('../interactive/serviceGrants').ServiceGrants
  /** PDF, PowerPoint and slide images made from a version and kept with it. */
  artifactExports?: import('../interactive/exports').ArtifactExports
  /** Each project's live address watch. */
  uptime?: import('../workspace/deploy/uptime').UptimeWatches
  /** The person's own API keys for media services. */
  mediaAccounts?: import('../media/mediaAccounts').MediaAccounts
  localApps?: import('../workspace/deploy/localApp').LocalApps
  /** Each project's production database address, which a production deploy's migrations run against. */
  migrations?: import('../workspace/deploy/migrations').ProductionMigrations
  pageAi?: import('../interactive/pageAi').PageAi
  /** Abilities: live checks per provider and calls routed to a provider that has one. */
  abilities?: import('../agent/abilities').AbilityService
  /** Sends a page's notification to paired phones and this host's desktop. */
  notifyPage?: (page: import('@ramu/shared/artifacts').ArtifactInfo, title: string, body: string) => void
  /** Pages opened to people without Ramu, each on its own listener and tunnel. */
  publicPages?: import('../interactive/publicPages').PublicPages
  publicPageTunnel?: () => import('@ramu/shared/types').TunnelChoice
  /** Addresses a sender can reach this host's page webhooks at. */
  artifactWebhookBases?: () => string[]
  diagnostics?: import('../background/diagnostics').LocalDiagnostics
  externalSkills?: import('../memory/externalSkills').ExternalSkills
  workspace: Workspace
  terminals: TerminalService
  resources?: import('../background/resources').ResourceService
  servers?: import('../background/servers').ServerService
  customAgents?: import('../agent/customAgents').CustomAgentStore
  testDevices?: import('../testDevice/testDevices').TestDevices
  agents: AgentService
  schedules: ScheduleService
  pullRequestWatches?: PullRequestWatchService
  ship?: import('../background/ship').ShipService
  livePullRequests?: import('../background/livePullRequests').LivePullRequests
  pullRequestIndex?: import('../background/pullRequestIndex').PullRequestIndex
  pullRequestDrafts?: import('../background/pullRequestDrafts').PullRequestDrafts
  pullRequestWrites?: import('../background/pullRequestWrites').PullRequestWrites
  settingsChanges?: import('../settings/settingsChanges').SettingsChanges
  /** Tools suggested in threads from what they do. */
  toolSuggestions?: import('../plugins/toolSuggestions').ToolSuggestions
  learning?: LearningService
  memory?: MemoryService
  summaries?: SummaryService
  agentThreads?: import('../background/agentThreads').AgentThreadService
  rules?: RuleStore
  /** Claude Code's copies of path rules; synced whenever rules or a project's repositories change. */
  ruleFiles?: RuleFiles
  reviews: ReviewService
  notices?: NoticeInbox
}
export interface RuntimeHost {
  browserDevice?(): string | undefined
  browserGrantEligible?(deviceId: string): boolean
  /** The name of the device the current call came from: a paired device's own name, or this computer's. */
  callerName?(): string | undefined
  userData: string
  /** Initial integration/credential administration is local to the execution host. */
  canAdministerIntegrations?(): boolean
  /** The current call comes from a paired device with view-only access. */
  callerIsViewer?(): boolean
  send(channel: string, payload: unknown): void
  native(method: 'pickExecutable' | 'pickDirectory' | 'pickAttachments' | 'reveal', path?: string): Promise<unknown>
  /** This host's own desktop app, when it is open: whether it is, and asking it to install a prepared update. */
  desktopApp?: {
    attached(): boolean
    installUpdate(version: string): Promise<void>
    /** Hears what each desktop app reports about the app installed on this host when it connects. */
    onInstalled?(listener: (app: InstalledApp) => void): void
  }
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
  accountUsage: AccountUsage
  /** Reads every login's plan usage now, after logins, keys or enabled providers change. */
  usageConfigurationChanged: () => void
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
