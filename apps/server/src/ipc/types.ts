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
import type { KeyedLock } from './keyedLock'
import type { FileWatchers } from './watchers'

export interface Services {
  threadTitles?: import('../agent/threadTitles').ThreadTitles
  interactive?: import('../interactive/store').InteractiveStore
  diagnostics?: import('../background/diagnostics').LocalDiagnostics
  externalSkills?: import('../memory/externalSkills').ExternalSkills
  workspace: Workspace
  terminals: TerminalService
  agents: AgentService
  schedules: ScheduleService
  pullRequestWatches?: PullRequestWatchService
  recaps: RecapService
  learning?: LearningService
  memory?: MemoryService
  summaries?: SummaryService
  reviews: ReviewService
  notices?: NoticeInbox
}
export interface RuntimeHost {
  userData: string
  send(channel: string, payload: unknown): void
  native(method: 'pickExecutable' | 'pickDirectory' | 'pickAttachments' | 'reveal', path?: string): Promise<unknown>
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
  usage: UsageService
  extraUsage: ExtraUsageReader
  accountUsage: AccountUsage
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
