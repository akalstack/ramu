import type { SettingsSnapshot, SettingEdit } from './settingsCompatibility'
import type { BackgroundActivity } from './activity'
import type { AppUpdateStatus } from './updates'
import type { ProviderConfiguration, ProviderStatus } from './providers'
// The renderer-facing contract. Each method maps 1:1 to a validated handler in src/main/ipc.ts.
import type {
  PullMode, CommitBranchOptions,
  ChangeReview, ChangeFile, ReviewBranchState, ReviewFileState, ReviewComment, UndoPreview, FileContext, SkillInfo, ScheduleInput, ScheduleRule, Schedule, ScheduleRun, RecapSnapshot, BackgroundStatus, NetworkStatus, NetworkSettingsInput, PairingOffer, Computers, Memory, MemoryInput, MemorySnapshot,
  SearchOptions,
  SearchResults,
  ReplaceFilePreview,
  AppPreferences,
  ChatGoal,
  UsageReading,
  ContextUsage,
  Aside,
  AgentEvent,
  Attachment,
  AgentSettings,
  ModelPreferences,
  ProviderCatalog,
  AgentScope,
  ProjectAction,
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
  'learning.get'(): import('./types').LearningSnapshot
  'learning.apply'(id: string): void
  'learning.retry'(id: string): void
  'learning.dismiss'(id: string): void
  'learning.control'(id: string, action: 'pin' | 'unpin' | 'disable' | 'archive' | 'restore'): void
  'learning.history'(id: string): import('./types').ManagedSkill[]
  'learning.revert'(id: string, revision: number): void
  'learning.run'(): void
  'agent.checkpoint'(id: string): import('./types').SessionCheckpoint | null
  'agent.compression'(id: string): { outputs: number; originalCharacters: number; compactCharacters: number; estimatedTokensAvoided: number; note: string }
  'memory.revert'(id: string, index: number, updatedAt: number): Memory

  'app.systemLanguages': () => string[]
  'reviews.list'(sessionId?: string): ChangeReview[]
  'reviews.get'(id: string): ChangeReview
  'reviews.branches'(id: string): ReviewBranchState[]
  'reviews.inspect'(id: string): ReviewFileState[]
  'reviews.compareCurrent'(id: string, fileId: string): ChangeFile
  'reviews.locate'(id: string, fileId: string, path: string): void
  'reviews.comment'(id: string, comment: Pick<ReviewComment, 'fileId' | 'side' | 'line' | 'endLine' | 'text' | 'scope'>, commentId?: string): ChangeReview
  'reviews.select'(id: string, commentIds: string[], selected: boolean): ChangeReview
  'reviews.reopenComment'(id: string, commentId: string): ChangeReview
  'reviews.reply'(id: string, commentId: string, text: string, replyId?: string): ChangeReview
  'reviews.removeReply'(id: string, commentId: string, replyId: string): ChangeReview
  'reviews.removeComment'(id: string, commentId: string): ChangeReview
  'reviews.resolveComment'(id: string, commentId: string): ChangeReview
  'reviews.sendComments'(id: string, commentIds: string[], note?: string, attachmentIds?: string[], context?: FileContext[]): ChangeReview
  'reviews.ai'(id: string): ChangeReview
  'reviews.markReviewed'(id: string, reviewed: boolean): ChangeReview
  'reviews.undoPreview'(id: string): UndoPreview
  'reviews.undoApply'(token: string, fileIds: string[]): ChangeReview
  'reviews.chatUndoPreview'(sessionId: string, userSeq: number): UndoPreview
  'reviews.chatUndoApply'(token: string, fileIds: string[]): void
  'activity.status'(): BackgroundActivity[]
  'updates.status'(): Promise<AppUpdateStatus>
  'updates.check'(): Promise<AppUpdateStatus>
  'updates.download'(): Promise<AppUpdateStatus>
  'updates.restart'(): Promise<void>
  /** Chats working or waiting for the user. */
  'agent.counts'(): { running: number; needsInput: number }
  'notifications.register'(token: string, computerId: string): void
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
  'network.pair'(): PairingOffer
  'network.revoke'(deviceId: string): NetworkStatus
  /** Computers this app is connected to, all at once. Handled by the desktop app itself. */
  'computers.settings.invoke'(id: string, method: string, args: unknown[]): unknown
  'computers.settings.get'(id: string): SettingsSnapshot
  'computers.settings.patch'(id: string, edits: SettingEdit[]): SettingsSnapshot
  'computers.list'(): Computers
  /** Brings a computer's window to the front. Rejects when it cannot be reached. */
  'computers.open'(id: string): void
  'computers.pair'(url: string, code: string, name?: string): Computers
  'computers.forget'(id: string): Computers
  'computers.retry'(id: string): Computers
  'computers.update'(id: string, changes: { name?: string; enabled?: boolean; retryMode?: 'events' | 'periodic' }): Computers
  /** Renderer acknowledgement after its workspace has been safely persisted. */
  'computers.checkpoint'(requestId: string, safe: boolean): boolean
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
  'recaps.act'(id: string, action: 'open' | 'done' | 'dismissed' | 'snoozed'): void
  'memory.get'(): MemorySnapshot
  'memory.save'(input: MemoryInput, id?: string): Memory
  'memory.archive'(id: string): Memory
  'memory.restore'(id: string): Memory
  'memory.delete'(id: string): void
  'memory.history'(id: string): { action: string; actor: string; reason: string | null; before: Partial<Memory> | null; at: number }[]
  'memory.dream'(): MemorySnapshot
  'folders.roots'(): string[]
  'folders.list'(path: string): { path: string; parent: string | null; folders: { name: string; path: string }[] }
  'folders.create'(parent: string, name: string): string
  'folders.clone'(parent: string, name: string, url: string): string
  'folders.addProject'(path: string): { project: Project; repositories: Repository[] }
  'projects.list'(): Project[]
  'projects.create'(name: string): Project
  'projects.inspect'(dir: string): FolderInspection
  'projects.addFolder'(dir: string): { project: Project; repositories: Repository[] }
  'repos.list'(projectId: string): Repository[]
  'repos.add'(projectId: string, dir: string): Repository
  'repos.pick'(purpose?: 'project' | 'repository'): string | null
  'workspaces.list'(): WorktreeWorkspace[]
  'tasks.list'(): Task[]
  'tasks.plan'(projectId: string, title: string, repoIds: string[]): WorktreePlanEntry[]
  'tasks.create'(input: CreateTaskInput, plan?: WorktreePlanEntry[]): Task
  'tasks.setup'(taskId: string): RepositoryBinding[]
  'tasks.rename'(taskId: string, title: string): Task
  /** AI-written title. An automatic call leaves a title the user typed alone; `force` replaces it. */
  'tasks.generateTitle'(taskId: string, settings: AgentSettings, force?: boolean): Task
  'tasks.archive'(taskId: string, archived: boolean): Task
  'tasks.pin'(taskId: string, pinned: boolean): Task
  'tasks.delete'(taskId: string, removeWorktrees: boolean): void
  'projects.rename'(projectId: string, name: string): Project
  'projects.reorder'(projectIds: string[]): Project[]
  'projects.remove'(projectId: string): void
  'projects.reveal'(projectId: string): void
  'projects.actions'(projectId: string): ProjectAction[]
  'projects.setActions'(projectId: string, actions: ProjectAction[]): ProjectAction[]
  'repos.remove'(repoId: string): void
  'tasks.bindings'(taskId: string): RepositoryBinding[]
  'settings.models.get'(): ModelPreferences | null
  'providers.status'(configuration?: ProviderConfiguration, checkLatest?: boolean): Promise<ProviderStatus[]>
  'providers.loginCommand'(provider: ProviderStatus['provider'], configuration?: ProviderConfiguration): Promise<string | null>
  /** In-app sign-in for runtimes without a login command (Antigravity). Resolves after the browser flow completes. */
  'providers.signIn'(provider: ProviderStatus['provider']): Promise<void>
  'providers.update'(provider: ProviderStatus['provider']): Promise<ProviderStatus>
  'providers.updates'(): Promise<ProviderStatus[]>
  'providers.dismissUpdate'(provider: ProviderStatus['provider'], binary: string, latestVersion: string): void
  'providers.pickBinary'(): string | null
  'settings.app.snapshot'(): SettingsSnapshot
  'settings.app.patch'(edits: SettingEdit[]): SettingsSnapshot
  'settings.app.get'(): AppPreferences
  'settings.app.set'(preferences: AppPreferences): void
  'settings.models.set'(preferences: ModelPreferences): void
  'ui.get'(): { workspace: WorkspaceUiState; tasks: Record<string, TaskUiState> }
  'ui.setWorkspace'(ui: WorkspaceUiState): void
  'ui.setTask'(taskId: string, ui: TaskUiState): void
  'files.search'(taskId: string, options: SearchOptions): SearchResults
  'files.replacePreview'(taskId: string, options: SearchOptions, replacement: string): ReplaceFilePreview[]
  'files.replaceApply'(taskId: string, options: SearchOptions, replacement: string, expected: ReplaceFilePreview[]): void
  'files.create'(taskId: string, repoId: string, path: string, kind: 'file' | 'dir'): void
  'files.rename'(taskId: string, repoId: string, path: string, destination: string): void
  'files.copy'(taskId: string, repoId: string, path: string, destination: string): void
  'files.import'(taskId: string, repoId: string, dir: string, paths: string[]): string[]
  'files.dropInfo'(paths: string[]): { path: string; kind: 'file' | 'dir' }[]
  /** Permanently deletes a file or folder inside the checkout. */
  'files.delete'(taskId: string, repoId: string, path: string): void
  'files.reveal'(taskId: string, repoId: string, path: string): void
  'files.list'(taskId: string, repoId: string, path: string): DirEntry[]
  'files.read'(taskId: string, repoId: string, path: string): FileContent
  'files.editorconfig'(taskId: string, repoId: string, path: string): EditorConfigProps
  'files.image'(taskId: string, repoId: string, path: string): string
  'files.media'(taskId: string, repoId: string, path: string): { mimeType: string; size: number; url: string }
  'files.write'(taskId: string, repoId: string, path: string, content: string, baseHash: string | null): SaveResult
  'git.status'(taskId: string, repoId: string): GitStatus
  'git.diff'(taskId: string, repoId: string, path: string, staged: boolean): DiffContents
  'git.stage'(taskId: string, repoId: string, paths: string[]): void
  'git.unstage'(taskId: string, repoId: string, paths: string[]): void
  'git.discardPreview'(taskId: string, repoId: string, paths: string[]): { fingerprint: string; files: { path: string; untracked: boolean }[] }
  'git.discard'(taskId: string, repoId: string, paths: string[], fingerprint?: string): void
  'git.undoCommit'(taskId: string, repoId: string, expectedHead: string): string
  'git.commitBranchInfo'(taskId: string, repoId: string): { branch: string | null; defaultBranch: string | null }
  'git.createBranch'(taskId: string, repoId: string, name: string): void
  'git.deleteBranch'(taskId: string, repoId: string, name: string): void
  'git.stashes'(taskId: string, repoId: string): GitStash[]
  'git.stashFiles'(taskId: string, repoId: string, oid: string): GitCommitFile[]
  'git.stashFileDiff'(taskId: string, repoId: string, oid: string, path: string): DiffContents
  'git.stash'(taskId: string, repoId: string, name: string, stagedOnly?: boolean): void
  'git.popStash'(taskId: string, repoId: string, oid: string): void
  'git.applyStash'(taskId: string, repoId: string, oid: string): void
  'git.dropStash'(taskId: string, repoId: string, oid: string): void
  'git.commit'(taskId: string, repoId: string, message: string, fingerprint?: string, amendHead?: string, branchOptions?: CommitBranchOptions): string
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
  'git.generateCommit'(taskId: string, repoId: string, settings: AgentSettings): CommitDraft
  'term.open'(taskId: string, repoId: string | null, cols: number, rows: number): TerminalInfo
  'term.openSetup'(cols: number, rows: number): TerminalInfo
  'term.write'(termId: string, data: string): void
  'term.resize'(termId: string, cols: number, rows: number): void
  'term.close'(termId: string): void
  /** How many of these terminals have a command running in the foreground. */
  'term.busy'(termIds: string[]): number
  'editor.menu'(options: { selection: string; editable: boolean; comment: boolean }, point: { x: number; y: number }): 'cut' | 'undo' | 'redo' | 'selectAll' | 'find' | 'comment' | { paste: string } | null
  'clipboard.write'(text: string): void
  'term.menu'(selection: string, point: { x: number; y: number }): 'selectAll' | 'clear' | { paste: string } | null
  'agent.list'(taskId: string): AgentSessionInfo[]
  'agent.get'(sessionId: string): AgentSessionInfo
  'agent.goal'(sessionId: string): ChatGoal | null
  'agent.goal.control'(sessionId: string, action: 'pause' | 'resume' | 'clear'): ChatGoal | null
  'agent.events'(sessionId: string): AgentEvent[]
  /** Sequenced persisted events for race-free remote hydration. */
  'agent.snapshot'(sessionId: string): { revision: number; events: { seq: number; event: AgentEvent }[] }
  'term.list'(taskId: string): TerminalInfo[]
  'term.snapshot'(termId: string): { output: string; cursor: number; exited: boolean }
  /** Your messages and the agent's replies that contain `query`, newest first, across every chat. */
  'agent.searchMessages'(query: string): ChatSearchHit[]
  'agent.scope'(taskId: string): AgentScope
  'attachments.pick'(): Attachment[]
  'attachments.add'(name: string, base64: string): Attachment
  'attachments.text'(attachmentId: string): string | null
  'attachments.preview'(id: string): string | null
  'attachments.menu'(id: string, removable: boolean, point: { x: number; y: number }): 'preview' | 'remove' | null
  'attachments.save'(id: string): boolean
  'attachments.copy'(id: string): void
  'attachments.reveal'(id: string): void
  'agent.start'(taskId: string, prompt: string, settings?: AgentSettings, attachments?: string[], context?: FileContext[]): AgentSessionInfo
  'agent.catalog'(refresh?: boolean): ProviderCatalog[]
  'agent.configure'(sessionId: string, settings: AgentSettings): AgentSessionInfo
  'files.all'(taskId: string): { repoId: string; path: string }[]
  'files.resolveLink'(taskId: string, href: string): { repoId: string; path: string; line?: number; column?: number } | null
  'agent.send'(sessionId: string, text: string): void
  'agent.submit'(sessionId: string, text: string, mode: 'queue' | 'steer', attachments?: string[], context?: FileContext[]): void
  'agent.removeQueued'(sessionId: string, messageId: string): void
  'agent.resumeQueue'(sessionId: string): void
  'agent.sendQueuedNow'(sessionId: string, messageId: string): void
  'agent.interrupt'(sessionId: string): void
  /** Opening message for a new chat that continues this one, carrying the transcript as context. */
  'agent.continuationPrompt'(sessionId: string): string
  'agent.stop'(sessionId: string): void
  /** Latest plan usage per provider and window. */
  'usage.get'(): UsageReading[]
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
  'aside.ask'(sessionId: string, asideId: string | null, quote: string, quoteFrom: 'assistant' | 'user', question: string): Aside
  'aside.delete'(sessionId: string, asideId: string): void
  /** Keep the chat's current provider despite the usage threshold: for the next message, for this chat until its limit resets, or clear. */
  'agent.holdProvider'(sessionId: string, scope: 'message' | 'chat' | null): void
  'agent.providerHold'(sessionId: string): 'message' | 'chat' | null
  /** Moves one running command to the background so the agent can carry on (Claude only). False when it already finished. */
  'agent.backgroundTool'(sessionId: string, toolUseId: string): boolean
  /** Stops one sub-agent or background task; the main agent keeps going. */
  'agent.stopTask'(sessionId: string, agentId: string): void
  /** Sends a message to a sub-agent through the main agent (Claude SendMessage, Codex send_input). */
  'agent.messageTask'(sessionId: string, agentId: string, text: string): void
  'agent.replyPermission'(sessionId: string, requestId: string, allow: boolean, message?: string): void
  'agent.replyQuestion'(sessionId: string, requestId: string, answers: Record<string, string>): void
  'agent.replyElicitation'(sessionId: string, requestId: string, action: import('./types').ElicitationAction, answers: Record<string, string>): void
  'agent.elicitationDraft'(sessionId: string, requestId: string, drafts: Record<string, string>): void
  'agent.questionDraft'(sessionId: string, requestId: string, drafts: Record<string, string>): void
  'agent.dismissQuestion'(sessionId: string, requestId: string): void
}

export type PushEvents = {
  'settings:changed': AppPreferences
  'settings:models': ModelPreferences
  'activity:changed': BackgroundActivity[]
  'menu:action': { action: 'settings' | 'check-updates' }
  'automation:changed': Record<string, never>
  'memory:changed': Record<string, never>
  /** `rejected`: the server no longer accepts this device's token, so reconnecting is pointless until it is paired again. */
  'background:connection': { connected: boolean; rejected?: boolean }
  'computers:changed': Computers
  'workspace:visibility': { visible: boolean }
  'workspace:checkpoint': { requestId: string }
  'updates:changed': AppUpdateStatus
  'providers:updates': ProviderStatus[]
  'notify:inapp': { sessionId: string; taskId: string; kind: 'done' | 'input' | 'failed'; title: string; body: string }
  'notify:open': { sessionId: string; taskId: string }
  'agent:event': { sessionId: string; event: AgentEvent; seq?: number; revision?: number }
  'usage:changed': UsageReading[]
  'context:changed': { sessionId: string; context: ContextUsage }
  'aside:changed': { sessionId: string; aside: Aside | null; asideId: string }
  'term:data': { id: string; data: string; cursor?: number }
  'term:exit': { id: string; code: number }
  'fs:changed': { cwd: string; path: string }
}

export interface RamuBridge {
  invoke<M extends keyof RamuMethods>(method: M, ...args: Parameters<RamuMethods[M]>): Promise<Awaited<ReturnType<RamuMethods[M]>>>
  on<E extends keyof PushEvents>(event: E, listener: (payload: PushEvents[E]) => void): () => void
  /** The on-disk path of a file or folder dropped onto the window ('' when it has none). */
  pathForFile(file: File): string
}
