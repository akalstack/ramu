import type { z } from 'zod'
import type { FileContext, SkillInfo, AppPreferences } from '@ramu/shared/types'
import type { NoticeInbox } from '../notices'
import type { ActivityService } from '../activity'
import type { LearningService } from '../learning'
import type { CompressionService } from '../compression'
import type { ProviderService } from '../providers'
import type { KeepAwakeService } from '../keepAwake'
import type { AppUpdateService } from '../appUpdates'
import type { UsageService } from '../usage'
import type { ExtraUsageReader } from '../providerUsage'
import type { AccountUsage } from '../accountUsage'
import type { AttachmentStore } from '../attachments'
import type { HostFolders } from '../hostFolders'
import type { AgentService } from '../agent'
import type { TerminalService } from '../pty'
import type { Workspace } from '../workspace'
import type { ScheduleService } from '../schedules'
import type { ReviewService } from '../reviews'
import type { RecapService } from '../recaps'
import type { MemoryService } from '../memory'
import type { KeyedLock } from './keyedLock'
import type { FileWatchers } from './watchers'

export interface Services {
  workspace: Workspace
  terminals: TerminalService
  agents: AgentService
  schedules: ScheduleService
  recaps: RecapService
  learning?: LearningService
  compression?: CompressionService
  memory?: MemoryService
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
  savePreferences(preferences: AppPreferences): void
  /** The stored preferences as written, without defaults or validation. */
  storedPreferences(): Partial<AppPreferences>
  managedSkills(taskId: string): SkillInfo[]
  withContext(ws: Workspace, taskId: string, prompt: string, context?: FileContext[]): Promise<string>
  cwdOf(taskId: string, repoId: string): string
  gitCwdOf(taskId: string, repoId: string): string
}

/** A handler group: given the shared context, returns its slice of the method table. */
export type RegisterHandlers = (ctx: HandlerContext) => MethodTable
