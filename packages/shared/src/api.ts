import type { BranchChoice, BranchNamingIntent, BranchNamingStrategy } from './workspaceDefaults'
import type { HostOverview, HostDestination, HostTaskMethod } from './hostOverview'
import type { SettingsSnapshot, SettingEdit } from './settingsCompatibility'
import type { BackgroundActivity } from './chat/activity'
import type { RamuTheme, ThemeIssue, ThemeRole } from './theme'
import type { AppUpdateStatus } from './updates'
import type { ProviderConfiguration, ProviderStatus } from './providers/providers'
import type { LimitRetryResult } from './chat/providerWait'
import type {
  SharedMcpConnection,
  SharedMcpGrant,
  SharedMcpInspection,
  SharedMcpManagement,
  SharedMcpProviderAccount,
  SharedMcpSelection,
} from './mcp'
// The renderer-facing contract. Each method maps 1:1 to a validated handler in src/main/ipc.ts.
import type {
  PullMode,
  CommitBranchOptions,
  ChangeReview,
  ChangeFile,
  ReviewBranchState,
  ReviewFileState,
  ReviewComment,
  UndoPreview,
  FileContext,
  SkillInfo,
  ScheduleInput,
  ScheduleRule,
  Schedule,
  ScheduleRun,
  RecapSnapshot,
  BackgroundStatus,
  NetworkStatus,
  NetworkSettingsInput,
  PairingOffer,
  Computers,
  Memory,
  MemoryInput,
  MemorySnapshot,
  SearchOptions,
  SearchResults,
  ReplaceFilePreview,
  AppPreferences,
  ChatGoal,
  UsageReading,
  ContextUsage,
  AgentMcpStatus,
  Aside,
  AgentEvent,
  Attachment,
  AgentSettings,
  ModelPreferences,
  ProviderCatalog,
  AgentScope,
  ProjectAction,
  ProjectActionSettings,
  ChatSearchHit,
  FolderInspection,
  AgentSessionInfo,
  CreateTaskInput,
  DiffContents,
  DirEntry,
  FileContent,
  EditorConfigProps,
  GitStatus,
  GitCommit,
  GitCommitFile,
  GitStash,
  GitBranchInfo,
  CommitDraft,
  ForgeStatus,
  PullRequestWatchStatus,
  IssueLink,
  IssueSummary,
  PullRequestDraft,
  PullRequestFeedbackKind,
  PublishRepositoryInput,
  PullRequestInput,
  Project,
  Repository,
  RepositoryBinding,
  SaveResult,
  Task,
  TaskUiState,
  WorkspaceUiState,
  WorktreePlanEntry,
  WorktreeWorkspace,
} from './types'

export interface TerminalInfo {
  id: string
  taskId: string
  repoId: string | null
  cwd: string
  exited: boolean
  /** Set for a persistent command Ramu launched for a thread. */
  background?: true
}

export type BackgroundTerminalState = 'running' | 'stopping' | 'exited' | 'failed' | 'unknown'

/** One persistent command Ramu launched for a thread. The host owns identity, lifecycle and output. */
export interface BackgroundTerminalInfo {
  id: string
  taskId: string
  repoId: string | null
  cwd: string
  command: string
  state: BackgroundTerminalState
  startedAt: number
  endedAt: number | null
  exitCode: number | null
  cursor: number
  capabilities: { inspect: true; stop: boolean; forceStop: boolean; input: boolean }
}

/** Counts only: lock-screen content never includes prompts, paths, host names or credentials. */
export interface MobileLiveActivityContent {
  running: number
  waiting: number
  startedAt: number
  updatedAt: number
  locale: 'en' | 'id'
  phase: 'working' | 'waiting' | 'finished' | 'paused'
}
export interface MobileLiveActivityRegistration {
  activityId: string
  token: string
  computerId: string
  startedAt: number
  locale: 'en' | 'id'
  environment: 'sandbox' | 'production'
}

export interface RamuMethods {
  /** Local desktop-only document origin. Never forwarded to a remote host. */
  'app.content.mount'(html: string): string
  'app.content.release'(url: string): void
  'interactive.get'(sessionId: string, id: string, version: number): import('./interactive').InteractiveDocument
  'interactive.list'(sessionId: string): import('./interactive').InteractiveReference[]

  'onboarding.get'(): { needed: boolean }
  'onboarding.complete'(): void
  'diagnostics.export'(): string
  'diagnostics.clear'(): void
  'diagnostics.nativeEvent'(kind: 'renderer-crash' | 'desktop-crash'): void
  'skills.availability'(): { available: boolean; installUrl: string }
  'skills.find'(query: string): string
  'skills.stage'(input: {
    source: string
    skill?: string
    projectId: string | null
    updatingId?: string
  }): import('./types').SkillInstallPreview
  'skills.confirm'(stageId: string, includeScripts: boolean): import('./types').ManagedSkill
  'skills.cancel'(stageId: string): void
  'skills.updateSource'(id: string): import('./types').SkillInstallPreview
  'skills.move'(id: string, projectId: string | null): void
  'skills.remove'(id: string): void
  'agent.all'(): AgentSessionInfo[]
  'learning.get'(): import('./types').LearningSnapshot
  'learning.apply'(id: string): void
  'learning.retry'(id: string): void
  'learning.dismiss'(id: string): void
  'learning.control'(id: string, action: 'pin' | 'unpin' | 'disable' | 'archive' | 'restore'): void
  'learning.history'(id: string): import('./types').ManagedSkill[]
  'learning.revert'(id: string, revision: number): void
  'learning.run'(): void
  'agent.checkpoint'(id: string): import('./types').SessionCheckpoint | null
  'memory.revert'(id: string, index: number, updatedAt: number): Memory

  'app.systemLanguages': () => string[]
  'reviews.list'(sessionId?: string): ChangeReview[]
  'reviews.get'(id: string): ChangeReview
  'reviews.branches'(id: string): ReviewBranchState[]
  'reviews.inspect'(id: string): ReviewFileState[]
  'reviews.compareCurrent'(id: string, fileId: string): ChangeFile
  'reviews.locate'(id: string, fileId: string, path: string): void
  'reviews.comment'(
    id: string,
    comment: Pick<ReviewComment, 'fileId' | 'side' | 'line' | 'endLine' | 'text' | 'scope'>,
    commentId?: string,
  ): ChangeReview
  'reviews.select'(id: string, commentIds: string[], selected: boolean): ChangeReview
  'reviews.reopenComment'(id: string, commentId: string): ChangeReview
  'reviews.reply'(id: string, commentId: string, text: string, replyId?: string): ChangeReview
  'reviews.removeReply'(id: string, commentId: string, replyId: string): ChangeReview
  'reviews.removeComment'(id: string, commentId: string): ChangeReview
  'reviews.resolveComment'(id: string, commentId: string): ChangeReview
  'reviews.sendComments'(
    id: string,
    commentIds: string[],
    note?: string,
    attachmentIds?: string[],
    context?: FileContext[],
  ): ChangeReview
  'reviews.ai'(id: string): ChangeReview
  'reviews.markReviewed'(id: string, reviewed: boolean): ChangeReview
  'reviews.undoPreview'(id: string): UndoPreview
  'reviews.undoApply'(token: string, fileIds: string[]): ChangeReview
  'reviews.chatUndoPreview'(sessionId: string, userSeq: number): UndoPreview
  'reviews.chatUndoApply'(token: string, fileIds: string[]): void
  'activity.status'(): BackgroundActivity[]
  'activity.cancel'(id: string): void
  'updates.status'(): Promise<AppUpdateStatus>
  'updates.check'(): Promise<AppUpdateStatus>
  'updates.download'(): Promise<AppUpdateStatus>
  'updates.restart'(): Promise<void>
  /** Quits and reopens the desktop app; the background service keeps running. */
  'app.relaunch'(): void
  /** Chats working or waiting for the user. */
  'agent.counts'(): { running: number; needsInput: number }
  /** Notices waiting on a person, shared by every device paired with this computer. */
  'notices.list'(): import('./chat/notices').InboxNotice[]
  'notices.dismiss'(id: string): void
  'notices.clear'(): void
  'notifications.register'(token: string, computerId: string, categories?: string[]): void
  'notifications.unregister'(): void
  'liveActivity.status'(): { enabled: boolean }
  'liveActivity.register'(registration: MobileLiveActivityRegistration): { enabled: boolean }
  'liveActivity.unregister'(activityId: string): void
  'background.status'(): BackgroundStatus
  'background.stop'(): void
  'background.start'(): void
  'background.restart'(): void
  'background.keepAwake'(): { enabled: boolean; active: boolean; supported: boolean; error: string | null }
  'background.login'(enabled: boolean): { firstInstall: boolean }
  /** Access from other devices. These run only for the local desktop app, never for a paired device. */
  'network.status'(): NetworkStatus
  'network.configure'(input: NetworkSettingsInput): NetworkStatus
  'network.pair'(role?: 'owner' | 'viewer'): PairingOffer
  'network.revoke'(deviceId: string): NetworkStatus
  /** Computers this app is connected to, all at once. Handled by the desktop app itself. */
  'computers.settings.invoke'(id: string, method: string, args: unknown[]): unknown
  'computers.settings.get'(id: string): SettingsSnapshot
  'computers.settings.patch'(id: string, edits: SettingEdit[]): SettingsSnapshot
  'computers.list'(): Computers
  'computers.scope'(id: string | null): Computers
  'computers.tasks.invoke'<M extends HostTaskMethod>(
    id: string,
    method: M,
    args: Parameters<RamuMethods[M]>,
  ): ReturnType<RamuMethods[M]>
  /** Runs an allow-listed method on one host's server, whichever window asks. Same as `RamuBridge.invokeOn`. */
  'computers.invoke'(id: string, method: string, args: unknown[]): unknown
  'computers.overview'(id: string): HostOverview
  'computers.navigate'(id: string, destination: HostDestination): void
  'computers.navigation.ready'(): void
  /** The hosts whose workspace stores this window shows besides its own; their host events reach it while on screen. */
  'computers.recapAct'(
    id: string,
    recapId: string,
    action: 'open' | 'done' | 'dismissed' | 'snoozed',
    until?: number,
  ): void
  /** Brings a computer's window to the front. Rejects when it cannot be reached. */
  'computers.open'(id: string): void
  'computers.pair'(url: string, code: string, name?: string): Computers
  'computers.sshHosts'(): string[]
  /** Adds a computer over SSH: `target` is user@host or an alias from ~/.ssh/config. */
  'computers.pairSsh'(target: string, name?: string): Computers
  'computers.forget'(id: string): Computers
  'computers.retry'(id: string): Computers
  'computers.update'(
    id: string,
    changes: { name?: string; enabled?: boolean; retryMode?: 'events' | 'periodic' },
  ): Computers
  /** Renderer acknowledgement after its workspace has been safely persisted. */
  'skills.list'(taskId: string): SkillInfo[]
  'schedules.list'(): Schedule[]
  'schedules.save'(input: ScheduleInput, id?: string): Schedule
  'schedules.pause'(id: string, paused: boolean): Schedule
  'schedules.delete'(id: string): void
  'schedules.runNow'(id: string): ScheduleRun
  'schedules.runs'(id?: string): ScheduleRun[]
  'schedules.preview'(rule: ScheduleRule, timezone: string): number[]
  'recaps.get'(): RecapSnapshot
  'recaps.refresh'(): RecapSnapshot
  'recaps.act'(id: string, action: 'open' | 'done' | 'dismissed' | 'snoozed', until?: number): void
  'memory.get'(): MemorySnapshot
  'memory.save'(input: MemoryInput, id?: string): Memory
  'memory.archive'(id: string): Memory
  'memory.restore'(id: string): Memory
  'memory.delete'(id: string): void
  'memory.history'(
    id: string,
  ): { action: string; actor: string; reason: string | null; before: Partial<Memory> | null; at: number }[]
  'memory.dream'(): MemorySnapshot
  'summaries.get'(): import('./types').SummariesSnapshot
  'summaries.read'(id: string): import('./types').LibrarySummary
  'summaries.dismiss'(id: string): void
  'summaries.run'(): import('./types').SummaryRunResult
  /** Starts a review chat seeded with the summary and links it back. */
  'summaries.discuss'(id: string, text: string, settings?: AgentSettings): { taskId: string; sessionId: string }
  'folders.roots'(): string[]
  'folders.list'(path: string): { path: string; parent: string | null; folders: { name: string; path: string }[] }
  'folders.create'(parent: string, name: string): string
  'folders.clone'(parent: string, name: string, url: string): string
  'folders.addProject'(path: string): { project: Project; repositories: Repository[] }
  'projects.list'(): Project[]
  'projects.create'(name: string): Project
  'projects.inspect'(dir: string): FolderInspection
  'projects.addFolder'(dir: string, repos?: string[]): { project: Project; repositories: Repository[] }
  'repos.list'(projectId: string): Repository[]
  'repos.add'(projectId: string, dir: string): Repository
  'repos.pick'(purpose?: 'project' | 'repository'): string | null
  'workspaces.list'(): WorktreeWorkspace[]
  'workspaces.rename'(workspaceId: string, name: string, before: string): WorktreeWorkspace
  'tasks.list'(): Task[]
  'tasks.agentDefaults'(
    projectId: string,
    defaultProvider: AgentSettings['provider'],
  ): import('./workspace/agentDefaults').ProjectAgentDefaults
  'tasks.workspaceOptions'(projectId: string): {
    defaultCheckoutMode: 'current' | 'worktree'
    branchPrefix: string
    branchNaming: BranchNamingStrategy
    branchInstructions: string
    branchNameControls?: boolean
    configSource?: 'ramu.json' | '.ramu/config.json'
    configError?: string
    worktreeUnavailable: string | null
  }
  'tasks.plan'(
    projectId: string,
    title: string,
    repoIds: string[],
    choice?: BranchChoice,
    naming?: { branchPrefix: string; strategy: BranchNamingStrategy },
  ): WorktreePlanEntry[]
  'tasks.generateBranch'(projectId: string, title: string, intent: BranchNamingIntent, requestId?: string): BranchChoice
  'tasks.cancelBranch'(requestId: string): void
  'tasks.create'(input: CreateTaskInput, plan?: WorktreePlanEntry[]): Task
  'tasks.setup'(taskId: string): RepositoryBinding[]
  'tasks.rename'(taskId: string, title: string): Task
  /** AI-written title. An automatic call leaves a title the user typed alone; `force` replaces it. */
  'tasks.generateTitle'(taskId: string, settings: AgentSettings, force?: boolean): Task
  'tasks.archive'(taskId: string, archived: boolean): Task
  'tasks.pin'(taskId: string, pinned: boolean): Task
  'tasks.done'(taskId: string, done: boolean): Task
  'tasks.delete'(taskId: string, removeWorktrees: boolean): void
  'projects.rename'(projectId: string, name: string): Project
  'projects.reorder'(projectIds: string[]): Project[]
  'projects.remove'(projectId: string): void
  'projects.reveal'(projectId: string): void
  'projects.actions'(projectId: string): ProjectAction[]
  'projects.setActions'(projectId: string, actions: ProjectAction[]): ProjectAction[]
  'projects.actionSettings'(projectId: string): ProjectActionSettings
  'projects.setActionVisibility'(projectId: string, actionId: string, hidden: boolean): ProjectActionSettings
  'projects.resetActionOrder'(projectId: string): ProjectActionSettings
  'projects.reorderActions'(projectId: string, actionIds: string[]): ProjectActionSettings
  'repos.remove'(repoId: string): void
  'tasks.bindings'(taskId: string): RepositoryBinding[]
  'settings.models.get'(): ModelPreferences | null
  'providers.status'(
    configuration?: ProviderConfiguration,
    checkLatest?: boolean,
    refresh?: boolean,
  ): Promise<ProviderStatus[]>
  /** Sign-in email per provider and login ID, for the logins whose CLI reports one. */
  'providers.accountEmails'(): Promise<Record<string, Record<string, string>>>
  'mcp.status'(): SharedMcpManagement & { canAdminister: boolean }
  'mcp.save'(input: Omit<SharedMcpConnection, 'id' | 'hostId' | 'revision'>, connectionId?: string): SharedMcpConnection
  'mcp.account'(account: SharedMcpProviderAccount): void
  'mcp.check'(connectionId: string, selection: SharedMcpSelection): Promise<SharedMcpInspection>
  'mcp.approve'(input: Omit<SharedMcpGrant, 'id' | 'accountIds' | 'shared'> & { accountId: string }): SharedMcpGrant
  'mcp.disconnect'(connectionId: string): Promise<void>
  'mcp.remove'(connectionId: string): Promise<void>
  'mcp.checkCredentialStore'(): Promise<'available' | 'unavailable' | 'not-checked'>
  'providers.loginCommand'(
    provider: ProviderStatus['provider'],
    configuration?: ProviderConfiguration,
  ): Promise<string | null>
  /** In-app sign-in for runtimes without a login command (Antigravity). Resolves after the browser flow completes. */
  'providers.signIn'(provider: ProviderStatus['provider'], accountId?: string): Promise<void>
  'providers.update'(provider: ProviderStatus['provider']): Promise<ProviderStatus>
  'providers.updates'(): Promise<ProviderStatus[]>
  'providers.dismissUpdate'(provider: ProviderStatus['provider'], binary: string, latestVersion: string): void
  'providers.pickBinary'(): string | null
  'settings.app.snapshot'(): SettingsSnapshot
  'settings.app.patch'(edits: SettingEdit[]): SettingsSnapshot
  'settings.permissions.clear'(removal?: import('./types').PermissionRemoval): void
  'settings.permissions.list'(): import('./types').SavedPermissionRule[]
  'settings.permissions.remove'(id: string): void
  'settings.app.get'(): AppPreferences
  'settings.app.set'(preferences: AppPreferences): void
  'settings.models.set'(preferences: ModelPreferences): void
  'ui.get'(): { workspace: WorkspaceUiState; tasks: Record<string, TaskUiState> }
  'ui.setWorkspace'(ui: WorkspaceUiState): void
  'ui.setTask'(taskId: string, ui: TaskUiState): void
  'files.search'(taskId: string, options: SearchOptions): SearchResults
  'files.replacePreview'(taskId: string, options: SearchOptions, replacement: string): ReplaceFilePreview[]
  'files.replaceApply'(
    taskId: string,
    options: SearchOptions,
    replacement: string,
    expected: ReplaceFilePreview[],
  ): void
  'files.create'(taskId: string, repoId: string, path: string, kind: 'file' | 'dir'): void
  'files.rename'(taskId: string, repoId: string, path: string, destination: string): void
  'files.copy'(taskId: string, repoId: string, path: string, destination: string): void
  'files.import'(taskId: string, repoId: string, dir: string, paths: string[]): string[]
  'files.dropInfo'(paths: string[]): { path: string; kind: 'file' | 'dir' }[]
  /** Permanently deletes a file or folder inside the checkout. */
  'files.delete'(taskId: string, repoId: string, path: string): void
  'files.reveal'(taskId: string, repoId: string, path: string): void
  'files.explorerBindings'(context: string): RepositoryBinding[]
  'files.browse'(
    context: string,
    repoId: string,
    path: string,
    cursor?: string,
  ): {
    entries: DirEntry[]
    truncated: boolean
    nextCursor?: string
  }
  'files.list'(taskId: string, repoId: string, path: string): DirEntry[]
  'files.read'(taskId: string, repoId: string, path: string): FileContent
  'files.editorconfig'(taskId: string, repoId: string, path: string): EditorConfigProps
  'files.image'(taskId: string, repoId: string, path: string): string
  'files.media'(taskId: string, repoId: string, path: string): { mimeType: string; size: number; url: string }
  'files.write'(taskId: string, repoId: string, path: string, content: string, baseHash: string | null): SaveResult
  'git.status'(taskId: string, repoId: string): GitStatus
  'git.lineStats'(taskId: string, repoId: string): { added: number; removed: number }
  'git.diff'(taskId: string, repoId: string, path: string, staged: boolean | 'all'): DiffContents
  'git.stage'(taskId: string, repoId: string, paths: string[]): void
  'git.unstage'(taskId: string, repoId: string, paths: string[]): void
  'git.discardPreview'(
    taskId: string,
    repoId: string,
    paths: string[],
  ): { fingerprint: string; files: { path: string; untracked: boolean }[] }
  'git.discard'(taskId: string, repoId: string, paths: string[], fingerprint?: string): void
  'git.undoCommit'(taskId: string, repoId: string, expectedHead: string): string
  'git.commitBranchInfo'(taskId: string, repoId: string): { branch: string | null; defaultBranch: string | null }
  'git.createBranch'(taskId: string, repoId: string, name: string): void
  'git.createBranchFrom'(taskId: string, repoId: string, name: string, from: string): void
  'git.renameBranch'(taskId: string, repoId: string, name: string): void
  'git.mergeBranch'(taskId: string, repoId: string, name: string): void
  'git.deleteBranch'(taskId: string, repoId: string, name: string): void
  'git.stashes'(taskId: string, repoId: string): GitStash[]
  'git.stashFiles'(taskId: string, repoId: string, oid: string): GitCommitFile[]
  'git.stashFileDiff'(taskId: string, repoId: string, oid: string, path: string): DiffContents
  'git.stash'(taskId: string, repoId: string, name: string, stagedOnly?: boolean): void
  'git.popStash'(taskId: string, repoId: string, oid: string): void
  'git.applyStash'(taskId: string, repoId: string, oid: string): void
  'git.dropStash'(taskId: string, repoId: string, oid: string): void
  'git.commit'(
    taskId: string,
    repoId: string,
    message: string,
    fingerprint?: string,
    amendHead?: string,
    branchOptions?: CommitBranchOptions,
  ): string
  'git.history'(taskId: string, repoId: string): GitCommit[]
  'git.branches'(taskId: string, repoId: string): GitBranchInfo[]
  'git.checkout'(taskId: string, repoId: string, branch: string): void
  'git.init'(taskId: string, repoId: string): void
  'git.fetch'(taskId: string, repoId: string): void
  'git.pull'(taskId: string, repoId: string, mode?: PullMode): void
  'git.autoPull'(taskId: string, repoId: string): boolean
  'git.sync'(taskId: string, repoId: string): void
  'git.continueOperation'(taskId: string, repoId: string): void
  'git.abortOperation'(taskId: string, repoId: string): void
  'git.push'(taskId: string, repoId: string, expectedBranch?: string): void
  'git.commitFiles'(taskId: string, repoId: string, oid: string): GitCommitFile[]
  'git.commitFileDiff'(taskId: string, repoId: string, oid: string, path: string): DiffContents
  'git.commitDetails'(taskId: string, repoId: string, oid: string): string
  'git.compareUpstream'(taskId: string, repoId: string): string
  'git.generateCommit'(taskId: string, repoId: string, settings: AgentSettings, includeBranch?: boolean): CommitDraft
  /** The pull request for the checked-out branch, through the GitHub CLI. */
  'forge.pullRequest'(taskId: string, repoId: string): ForgeStatus
  'forge.watchStatus'(taskId: string, repoId: string, url: string): PullRequestWatchStatus
  'forge.watch'(taskId: string, repoId: string, url: string, sessionId: string | null): void
  /** Delivers feedback to the watched thread, or returns null when no thread is watching. */
  'forge.sendFeedback'(taskId: string, repoId: string, kind: PullRequestFeedbackKind): string | null
  'forge.pullRequestDraft'(taskId: string, repoId: string): PullRequestDraft
  /** Publishes the branch when needed, then opens the pull request. */
  'forge.publishRepository'(taskId: string, repoId: string, input: PublishRepositoryInput): void
  'forge.createPullRequest'(taskId: string, repoId: string, input: PullRequestInput): ForgeStatus
  /** An opening message that hands failing checks or open review comments to an agent. */
  'forge.pullRequestFeedback'(taskId: string, repoId: string, kind: PullRequestFeedbackKind): string
  'forge.issues'(repoId: string, search: string): IssueSummary[]
  'forge.issue'(repoId: string, number: number): { link: IssueLink; prompt: string }
  /** Records the issue a chat was started from, so its pull request can close it. */
  'forge.linkIssue'(taskId: string, link: IssueLink | null): void
  'forge.issueLink'(taskId: string): IssueLink | null
  'term.open'(taskId: string, repoId: string | null, cols: number, rows: number): TerminalInfo
  'term.openSetup'(cols: number, rows: number): TerminalInfo
  'term.write'(termId: string, data: string): void
  'term.resize'(termId: string, cols: number, rows: number): void
  'term.close'(termId: string): void
  /** How many of these terminals have a command running in the foreground. */
  'term.busy'(termIds: string[]): number
  'editor.menu'(
    options: { selection: string; editable: boolean; comment: boolean },
    point: { x: number; y: number },
  ): 'cut' | 'undo' | 'redo' | 'selectAll' | 'find' | 'comment' | { paste: string } | null
  'clipboard.write'(text: string): void
  'term.menu'(selection: string, point: { x: number; y: number }): 'selectAll' | 'clear' | { paste: string } | null
  'agent.list'(taskId: string): AgentSessionInfo[]
  'agent.get'(sessionId: string): AgentSessionInfo
  'agent.goal'(sessionId: string): ChatGoal | null
  'agent.goal.control'(sessionId: string, action: 'pause' | 'resume' | 'clear'): ChatGoal | null
  /**
   * Sets, changes or removes (null or blank) the command Ramu runs when the agent claims the goal is done. Only the user
   * can call this; the agent's goal tools cannot. Rejects with no goal, or a completed one. The command runs in the
   * thread's folder with a ten-minute limit.
   */
  'agent.goal.verify'(sessionId: string, command: string | null): ChatGoal
  'agent.events'(sessionId: string): AgentEvent[]
  /** Sequenced persisted events for race-free remote hydration. */
  'agent.snapshot'(sessionId: string): { revision: number; events: { seq: number; event: AgentEvent }[] }
  'term.list'(taskId: string): TerminalInfo[]
  /** Starts a persistent command in the thread's folder; repeating a running one returns it instead of starting another. */
  'term.background.launch'(taskId: string, repoId: string | null, command: string): BackgroundTerminalInfo
  /** The thread's persistent commands, running first. Works while the thread is idle. */
  'term.background.list'(taskId: string): BackgroundTerminalInfo[]
  /** One command and its bounded output; rejects an id the thread does not own. */
  'term.background.inspect'(taskId: string, termId: string): BackgroundTerminalInfo & { output: string }
  /** Requests termination of that command's process group (`force` kills it). Safe to repeat and after it ended. */
  'term.background.stop'(taskId: string, termId: string, force?: boolean): BackgroundTerminalInfo
  'term.snapshot'(termId: string): { output: string; cursor: number; exited: boolean }
  /** Your messages and the agent's replies that contain `query`, newest first, across every chat. */
  'agent.searchMessages'(query: string): ChatSearchHit[]
  'agent.scope'(taskId: string): AgentScope
  'attachments.pick'(): Attachment[]
  'attachments.add'(name: string, base64: string): Attachment
  'attachments.status'(ids: string[]): { id: string; available: boolean }[]
  'attachments.text'(attachmentId: string): string | null
  'attachments.preview'(id: string): string | null
  'attachments.menu'(id: string, removable: boolean, point: { x: number; y: number }): 'preview' | 'remove' | null
  'attachments.save'(id: string): boolean
  'attachments.copy'(id: string): void
  'attachments.reveal'(id: string): void
  'agent.start'(
    taskId: string,
    prompt: string,
    settings?: AgentSettings,
    attachments?: string[],
    context?: FileContext[],
  ): AgentSessionInfo
  'agent.catalog'(refresh?: boolean): ProviderCatalog[]
  'agent.configure'(sessionId: string, settings: AgentSettings): AgentSessionInfo
  'files.all'(taskId: string): { repoId: string; path: string }[]
  'files.resolveLink'(
    taskId: string,
    href: string,
    /** `folders` also resolves directories (`kind: 'folder'`); without it only files match. */
    options?: { folders?: boolean },
  ): { repoId: string; path: string; line?: number; column?: number; kind?: 'file' | 'folder' } | null
  'agent.send'(sessionId: string, text: string): void
  'agent.submit'(
    sessionId: string,
    text: string,
    mode: 'queue' | 'steer',
    attachments?: string[],
    context?: FileContext[],
  ): void
  'agent.removeQueued'(sessionId: string, messageId: string): void
  'agent.reorderQueued'(sessionId: string, order: string[]): void
  'agent.resumeQueue'(sessionId: string): void
  'agent.sendQueuedNow'(sessionId: string, messageId: string): void
  'agent.interrupt'(sessionId: string): void
  /**
   * Try again now for a thread held at a usage limit: re-checks usage and, only if there is room or the provider has no
   * reading, sends the continuation. Otherwise the thread stays in the limit wait with the updated reset time and no
   * failed turn. A thread that is not at a limit returns `{ resumed: false, retryAt: null, guessed: false }`.
   */
  'agent.retryLimitNow'(sessionId: string): LimitRetryResult
  /**
   * Sets this thread's own auto-resume choice (true or false), or clears it with null to follow the global
   * `fallback.autoResume`. Takes effect at once: it clears or re-arms the thread's limit timer. Does not touch the provider.
   */
  'agent.setAutoResume'(sessionId: string, autoResume: boolean | null): AgentSessionInfo
  /** Opening message for a new chat that continues this one, carrying the transcript as context. */
  'agent.continuationPrompt'(sessionId: string): string
  'agent.stop'(sessionId: string): void
  'agent.rewind'(sessionId: string, userSeq: number): void
  /** Latest plan usage per provider and window. */
  'usage.get'(): UsageReading[]
  /** Readings for every login of every provider, not just the selected one. */
  'usage.accounts'(): UsageReading[]
  /** Reads Claude's plan usage now, without a turn, when the stored reading is old. */
  'usage.refresh'(): UsageReading[]
  /** The context window usage last reported for a chat, if any. */
  'agent.context'(sessionId: string): ContextUsage | null
  /** Whether Codex trusts Ramu's sub-agent hook. */
  'codex.hook.status'(): { trusted: boolean; error?: string }
  /** Claude Code's own advisor model from the user's Claude settings, or null when it is off. */
  'advisor.claude'(): { model: string | null }
  /** Writes the one trust entry for Ramu's hook into Codex's own config (~/.codex/config.toml). */
  'codex.hook.trust'(): { trusted: boolean; error?: string }
  /** Side questions about a chat; they never reach the main conversation. */
  'aside.list'(sessionId: string): Aside[]
  /** Starts an aside (asideId null) or continues one. Returns at once; the answer arrives as aside:changed. */
  'aside.ask'(
    sessionId: string,
    asideId: string | null,
    quote: string,
    quoteFrom: 'assistant' | 'user',
    question: string,
  ): Aside
  'aside.delete'(sessionId: string, asideId: string): void
  /**
   * A draft theme from this host's provider for a brief. `seed` is the theme being refined; locked roles come back
   * unchanged. The draft may carry readability issues after the repair rounds; applying it stays a device action.
   */
  'theme.generate'(
    brief: string,
    seed: RamuTheme,
    locked?: { light: ThemeRole[]; dark: ThemeRole[] },
    feedback?: string,
  ): { theme: RamuTheme; issues: ThemeIssue[]; provider: string; model: string }
  /** Up to three drafts in different directions for a brief, to choose between. Each uses a draft's provider usage. */
  'theme.candidates'(
    brief: string,
    seed: RamuTheme,
    locked?: { light: ThemeRole[]; dark: ThemeRole[] },
  ): { theme: RamuTheme; issues: ThemeIssue[]; provider: string; model: string }[]
  /** Keep the chat's current provider despite the usage threshold: for the next message, for this chat until its limit resets, or clear. */
  'agent.holdProvider'(sessionId: string, scope: 'message' | 'chat' | null): void
  'agent.mcpStatus'(sessionId: string): Promise<AgentMcpStatus>
  'agent.reloadMcp'(sessionId: string): Promise<void>
  'agent.reconnectMcp'(sessionId: string, name: string): Promise<void>
  'agent.providerHold'(sessionId: string): 'message' | 'chat' | 'picked' | null
  /** Moves one running command to the background so the agent can carry on (Claude only). False when it already finished. */
  'agent.backgroundTool'(sessionId: string, toolUseId: string): boolean
  /** Stops one sub-agent or background task; the main agent keeps going. */
  'agent.stopTask'(sessionId: string, agentId: string): void
  /** Sends a message to a sub-agent through the main agent (Claude SendMessage, Codex send_input). */
  'agent.messageTask'(sessionId: string, agentId: string, text: string): void
  'agent.replyPermission'(
    sessionId: string,
    requestId: string,
    allow: boolean,
    message?: string,
    scope?: 'once' | 'project' | 'user',
    pattern?: string,
  ): void
  'agent.forgetPermission'(sessionId: string, requestId: string, scope: 'project' | 'user'): void
  'agent.replyQuestion'(sessionId: string, requestId: string, answers: Record<string, string>): void
  'agent.replyElicitation'(
    sessionId: string,
    requestId: string,
    action: import('./types').ElicitationAction,
    answers: Record<string, string>,
  ): void
  'agent.elicitationDraft'(sessionId: string, requestId: string, drafts: Record<string, string>): void
  'agent.questionDraft'(sessionId: string, requestId: string, drafts: Record<string, string>): void
  'agent.dismissQuestion'(sessionId: string, requestId: string): void
}

export type PushEvents = {
  'settings:changed': AppPreferences
  'settings:models': ModelPreferences
  'activity:changed': BackgroundActivity[]
  'menu:action': { action: 'settings' | 'check-updates' }
  /** A `ramu://pair` link was opened; the text is validated by the screen that uses it. */
  'pair:link': { link: string }
  'automation:changed': Record<string, never>
  /** Projects, repositories, chats or sessions were created, renamed, moved or removed (by any client). */
  'workspace:changed': Record<string, never>
  'memory:changed': Record<string, never>
  /** `created` is the id of a summary that just became ready, so clients can raise one notification. */
  'summaries:changed': { created: string | null }
  /** `rejected`: the server no longer accepts this device's token, so reconnecting is pointless until it is paired again. */
  'background:connection': { connected: boolean; rejected?: boolean }
  'computers:changed': Computers
  'computers:navigate': { hostId: string; destination: HostDestination }
  'computers:activity': { ids: string[] }
  'updates:changed': AppUpdateStatus
  'providers:updates': ProviderStatus[]
  'mcp:changed': Record<string, never>
  'notify:inapp': {
    hostId?: string
    sessionId: string
    taskId: string
    kind: 'done' | 'input' | 'failed'
    title: string
    body: string
  }
  'notify:open': { sessionId: string; taskId: string }
  'agent:event': { sessionId: string; event: AgentEvent; seq?: number; revision?: number }
  /** The chat's transcript was cut back: events from `seq` on are gone. */
  'agent:rewound': { sessionId: string; seq: number }
  'usage:changed': UsageReading[]
  'context:changed': { sessionId: string; context: ContextUsage }
  'aside:changed': { sessionId: string; aside: Aside | null; asideId: string }
  'term:data': { id: string; data: string; cursor?: number }
  'term:exit': { id: string; code: number }
  /** A shell was opened, ended or closed in this workspace (`taskId` is the workspace context). */
  'term:changed': { taskId: string }
  'notices:changed': import('./chat/notices').InboxNotice[]
  'fs:changed': { cwd: string; path: string }
  /** Another window changed a device-wide UI value (`value` null means removed). */
  'device-state:changed': { key: string; value: string | null }
}

export interface RamuBridge {
  /** The host this window belongs to ('local' for the first window). Available before any call completes. */
  readonly hostId: string
  invoke<M extends keyof RamuMethods>(
    method: M,
    ...args: Parameters<RamuMethods[M]>
  ): Promise<Awaited<ReturnType<RamuMethods[M]>>>
  /**
   * Like `invoke`, but on an explicit host. Only methods the main process allow-lists work on a host other than this
   * window's own; it rejects for an unknown, offline or paused host. `invoke` itself is unchanged (variadic).
   */
  invokeOn<M extends keyof RamuMethods>(
    host: string,
    method: M,
    ...args: Parameters<RamuMethods[M]>
  ): Promise<Awaited<ReturnType<RamuMethods[M]>>>
  /**
   * Host events carry their server's host ID; window events carry the shell's host ID.
   */
  on<E extends keyof PushEvents>(event: E, listener: (payload: PushEvents[E], hostId?: string) => void): () => void
  /** Device-wide UI state (panel widths and the like) shared by every window, loaded synchronously at startup. */
  readonly deviceState: Readonly<Record<string, string>>
  setDeviceState(key: string, value: string | null): void
  /** The on-disk path of a file or folder dropped onto the window ('' when it has none). */
  pathForFile(file: File): string
}
