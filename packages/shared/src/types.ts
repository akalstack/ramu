import type { ProviderConfiguration } from './providers'
// Domain and IPC types shared by the main process, preload and renderer.

export type CheckoutMode = 'current' | 'worktree'

export interface Project {
  id: string
  name: string
  /** Workspace folder the project was added from; agents run here. Null for legacy projects. */
  root: string | null
  createdAt: number
}

/** A saved command for a project, run from the window bar in a new terminal at the chat's workspace. */
export interface ProjectAction {
  id: string
  name: string
  command: string
  /** Optional shortcut in Ramu's key format, e.g. `mod+shift+r`. */
  keys?: string
}

/** A message in some chat that contains the searched text, with a short excerpt around the first match. */
export interface ChatSearchHit {
  taskId: string
  sessionId: string
  seq: number
  role: 'user' | 'agent'
  snippet: string
}

/** What a folder chosen as a new project turned out to be. */
export type FolderInspection =
  | { kind: 'repo'; root: string; name: string }
  | { kind: 'workspace'; root: string; name: string; repos: string[] }
  | { kind: 'none'; root: string }

/** Where an agent for a task runs: a working directory plus any directories outside it. */
export interface AgentScope {
  cwd: string
  additionalDirs: string[]
  /** Binding directories the agent may write to; used to coordinate writers across tasks. */
  covers: string[]
}

export interface Repository {
  id: string
  projectId: string
  /** Display label; unique within a project. */
  name: string
  /** Canonical (realpath) Git top-level directory. */
  root: string
}

export type TaskStatus = 'idle' | 'running' | 'needs-input' | 'ready-for-review' | 'failed' | 'archived'

export interface WorktreeWorkspace {
  id: string
  projectId: string
  name: string
  createdAt: number
}

/** A project-level chat. The legacy Task name remains for stored-profile compatibility. */
export interface Task {
  id: string
  projectId: string
  title: string
  mode: CheckoutMode
  workspaceId: string | null
  status: TaskStatus
  createdAt: number
  /** When the chat was pinned to the top of the sidebar, or null. */
  pinnedAt: number | null
  /** Latest of creation and the newest agent session start. */
  lastActiveAt: number
  /** Set while every provider is at its usage limit: when Ramu next tries to continue the chat on its own. */
  waitingUntil?: number | null
}

export type BindingSetupState = 'ready' | 'pending' | 'failed'

/** Task + repository + mode + the working directory every surface must use. */
export interface RepositoryBinding {
  /** A plain folder supports files and terminals, without Git controls. */
  folderOnly?: boolean
  /** A project folder that is not a Git repository yet; Source Control offers to initialize it. */
  notGit?: boolean
  taskId: string
  repoId: string
  repoName: string
  mode: CheckoutMode
  /** Canonical working directory: the repo root (current) or the task worktree. */
  cwd: string
  /** Task branch for worktree bindings; null for current-checkout bindings. */
  taskBranch: string | null
  baseRef: string | null
  setupState: BindingSetupState
  setupError: string | null
}

export interface WorktreePlanEntry {
  repoId: string
  repoName: string
  baseRef: string
  taskBranch: string
  path: string
}

export interface CreateTaskInput {
  /** Reuse an isolated workspace instead of creating new worktrees. */
  workspaceId?: string
  projectId: string
  title: string
  mode: CheckoutMode
}

export interface DirEntry {
  name: string
  /** Path relative to the binding cwd, POSIX separators. */
  path: string
  kind: 'file' | 'dir'
}

export interface FileContent {
  content: string
  /** sha256 of the bytes on disk when read; used to refuse silent overwrites. */
  hash: string
}

/** Editor settings resolved from .editorconfig; anything the files do not set is left out. */
export interface EditorConfigProps {
  indentStyle?: 'space' | 'tab'
  indentSize?: number | 'tab'
  tabWidth?: number
  endOfLine?: 'lf' | 'crlf'
  insertFinalNewline?: boolean
  trimTrailingWhitespace?: boolean
}

export type SaveResult = { ok: true; hash: string } | { ok: false; reason: 'changed-on-disk'; diskHash: string }

export type GitFileState = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'type-changed' | 'untracked' | 'unmerged'

export interface GitStatusEntry {
  path: string
  origPath?: string
  /** Change between HEAD and index, or null. */
  staged: GitFileState | null
  /** Change between index and working tree, or null. */
  unstaged: GitFileState | null
}

export interface GitStatus {
  branch: string | null
  detached: boolean
  oid: string | null
  upstream: string | null
  ahead: number
  behind: number
  entries: GitStatusEntry[]
  /** A rebase or merge left in progress, usually by a conflicting pull. */
  operation?: GitOperation | null
  /** Whether any remote is configured; without one there is nothing to sync or publish to. */
  remote?: boolean
}

export type GitOperation = 'rebase' | 'merge'
export type PullMode = 'rebase' | 'merge' | 'ff-only'
/** How drafted commit messages are worded: Conventional Commits, the repository's own recent style, or the user's instructions. */
export type CommitStyle = 'conventional' | 'repository' | 'custom'
export type CommitAction = 'commit' | 'push' | 'sync'

export type DiffSide = 'HEAD' | 'INDEX' | 'WORKTREE'

export interface DiffContents {
  original: string
  modified: string
}

// ---- Agent ----

export type AgentProvider = 'claude-code' | 'codex' | 'opencode' | 'cursor' | 'antigravity'
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
export const RESPONSE_STYLES = ['default', 'concise', 'detailed', 'adhd', 'caveman', 'custom'] as const
export type ResponseStyle = (typeof RESPONSE_STYLES)[number]
export const RESPONSE_STYLE_LABELS: Record<ResponseStyle, string> = { default: 'Default', concise: 'Concise', detailed: 'Detailed', adhd: 'ADHD-friendly', caveman: 'Caveman', custom: 'Custom' }
export interface IntelligencePreferences {
  responseStyle: ResponseStyle
  responseInstructions: string
  responseSkill: string
  toolSearch: boolean
  rtk: boolean
  compression: 'off' | 'balanced' | 'aggressive'
  learning: 'off' | 'review' | 'auto'
  maintenanceModel: { provider: AgentProvider; model: string; effort: ReasoningEffort | null } | null
  dailyReviews: number
  archiveSkillDays: number
}
export const DEFAULT_INTELLIGENCE_PREFERENCES: IntelligencePreferences = { responseStyle: 'default', responseInstructions: '', responseSkill: '', toolSearch: true, rtk: false, compression: 'balanced', learning: 'auto', maintenanceModel: null, dailyReviews: 5, archiveSkillDays: 90 }
export interface ManagedSkill { id: string; projectId: string | null; name: string; description: string; content: string; status: 'active' | 'disabled' | 'archived'; pinned: boolean; revision: number; createdAt: number; updatedAt: number; lastUsedAt: number | null; useCount: number; sourceSessionId: string; sourceSeq: number }
export interface LearningJob { sessionTitle?: string; memoryVersions?: Record<string, number>; skillVersions?: Record<string, number>; id: string; sessionId: string; projectId: string | null; seq: number; status: 'queued' | 'running' | 'pending' | 'applied' | 'dismissed' | 'failed'; createdAt: number; error: string | null; proposal: string | null }
export interface LearningSnapshot { skills: ManagedSkill[]; jobs: LearningJob[]; running: boolean }
export interface SessionCheckpoint { sessionId: string; seq: number; summary: string; updatedAt: number }

export interface AgentSettings {
  provider: AgentProvider
  /** Pinned credential profile. Existing chats without this field use the original CLI account. */
  accountId?: string
  /** Empty means the provider's default. */
  model: string
  effort: ReasoningEffort | null
  serviceTier?: 'standard' | 'fast'
  access: 'edits' | 'auto' | 'full'
  autoFallback: boolean
  responseStyle?: ResponseStyle | 'inherit'
}
export interface AgentModel {
  provider: AgentProvider
  id: string
  name: string
  efforts: ReasoningEffort[]
  defaultEffort: ReasoningEffort | null
  isDefault: boolean
  serviceTiers?: string[]
}
export interface ProviderCatalog {
  provider: AgentProvider
  models: AgentModel[]
  error?: string
}
export const DEFAULT_AGENT_SETTINGS: AgentSettings = { provider: 'claude-code', model: '', effort: null, access: 'auto', autoFallback: true, serviceTier: 'standard' }

export type AgentSessionState =
  | 'starting'
  | 'running'
  | 'needs-input'
  | 'idle'
  | 'failed'
  | 'stopped'
  /** Transcript restored from disk; no live process. */
  | 'restored'

export interface AgentSessionInfo {
  id: string
  taskId: string
  /** Set only for legacy single-repository sessions. */
  repoId: string | null
  provider: AgentProvider
  settings: AgentSettings
  cwd: string
  additionalDirs: string[]
  covers: string[]
  state: AgentSessionState
  providerSessionId: string | null
  /** Set for a sub-agent Ramu runs as its own session; it belongs to that chat and is not listed. */
  parentId?: string | null
  createdAt: number
  /** The first prompt, used as the conversation's title. */
  title: string
}

export interface ElicitationField {
  id: string; label: string; description?: string; type: 'string' | 'number' | 'integer' | 'boolean' | 'array'; required: boolean
  options: { value: string; label: string }[]; defaultValue?: string
}
export interface AgentElicitation { requestId: string; serverName: string; message: string; mode: 'form' | 'url'; fields: ElicitationField[]; url?: string; schema?: Record<string, unknown> }
export type ElicitationAction = 'accept' | 'decline' | 'cancel'

export interface AgentQuestion {
  id?: string
  question: string
  header: string
  multiSelect: boolean
  options: { label: string; description: string }[]
}

export interface Attachment { id: string; name: string; size: number; mimeType: string; path: string }
export interface QueuedMessage { id: string; text: string; mode?: 'queue' | 'steer'; attachments?: Attachment[]; reviewId?: string }

/** When the event was recorded (ms). Absent on events stored before timestamps existed.
 *  `agentId` marks text and tool events that a sub-agent produced; they belong to that agent's own transcript, not the main one. */
export type AgentEvent = AgentEventBody & { at?: number; agentId?: string }

export type AgentTaskStatus = 'running' | 'completed' | 'failed' | 'stopped'
/** A sub-agent or background task the main agent started. Recorded once and updated in place as it progresses. */
export interface AgentTask {
  agentId: string
  /** The tool call that started it, when there is one. */
  toolUseId?: string
  name: string
  /** Claude subagent type (e.g. "Explore") or Codex agent role. */
  agentType?: string
  /** Claude task kind: local_agent, local_bash, … Absent for Codex sub-agents. */
  taskType?: string
  status: AgentTaskStatus
  /** Keeps running after the main turn ends. */
  background?: boolean
  prompt?: string
  /** Latest progress summary, or the final report. */
  summary?: string
  lastTool?: string
  error?: string
  tokens?: number
  toolUses?: number
  durationMs?: number
  startedAt?: number
  endedAt?: number
  /** What the main agent uses to address it (Claude agent name or id, Codex thread id). */
  address?: string
  canStop?: boolean
  canMessage?: boolean
  /** Restored from provider history; its previous process no longer exists. */
  recovered?: boolean
  recoveryError?: string
  /** Native parent session where recovered helper history belongs, including helpers discovered after fallback. */
  providerSessionId?: string
  /** Works in its own copy of the checkout; its changes are applied back when it finishes. */
  isolated?: boolean
  /** Where it actually runs, when Ramu chose it (cross-provider or fallback). */
  provider?: AgentProvider
  model?: string
  effort?: ReasoningEffort | null
  /** Provider switches along the way, oldest first. */
  steps?: { provider: AgentProvider; model?: string; reason: string; at: number }[]
}
/** The shared ACP tool taxonomy; native adapters can supply the same metadata. */
export type AgentToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other'
export type AgentToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed'
export type AgentContent =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data?: string; uri?: string; alt?: string }
  | { type: 'audio'; mimeType: string; data: string }
  | { type: 'resource'; uri: string; name: string; mimeType?: string; text?: string; blob?: string; description?: string }
  | { type: 'diff'; path: string; oldText: string | null; newText: string }
  | { type: 'terminal'; terminalId: string; output?: string }
  | { type: 'unsupported'; label: string; detail?: string }
export interface AgentToolDetails {
  toolKind?: AgentToolKind
  status?: AgentToolStatus
  title?: string
  input?: string
  content?: AgentContent[]
  locations?: { path: string; line?: number }[]
}
type AgentEventBody =
  | { kind: 'goal'; goal: ChatGoal | null }
  | { kind: 'schedule'; schedule: Schedule }
  | { kind: 'provider-wait'; retryAt: number | null; retryDelay?: number; updatedAt: number }
  | { kind: 'queue'; messages: QueuedMessage[]; paused?: boolean }
  | { kind: 'user'; text: string; attachments?: Attachment[] }
  | { kind: 'file-restore'; userSeq: number; fileCount: number }
  | { kind: 'init'; model: string; cwd: string; providerSessionId: string; provider?: AgentProvider }
  | { kind: 'text'; text: string; messageId?: string; nativeMessageId?: string }
  | { kind: 'content'; content: AgentContent[]; messageId?: string }
  | { kind: 'plan'; messageId: string; entries: { content: string; status: 'pending' | 'in_progress' | 'completed'; priority: 'low' | 'medium' | 'high' }[] }
  | ({ kind: 'tool-use'; toolUseId: string; name: string; summary: string } & AgentToolDetails)
  | ({ kind: 'tool-result'; toolUseId: string; isError: boolean; summary: string; running?: boolean } & AgentToolDetails)
  | { kind: 'turn-diff'; turnId: string; diff: string }
  | { kind: 'permission-request'; requestId: string; toolName: string; title: string; detail: string; }
  /** Plan usage a provider reported. Handed to the usage store and never recorded in the chat. */
  | { kind: 'usage'; readings: UsageReading[] }
  /** How full the model's context window is. Pushed to the chat's view and never recorded. */
  | { kind: 'context'; used: number; max: number }
  /** Reasoning the provider chose to show: Claude thinking blocks, Codex reasoning summaries. */
  | { kind: 'thinking'; text: string; messageId?: string }
  | ({ kind: 'elicitation' } & AgentElicitation)
  | { kind: 'question'; requestId: string; questions: AgentQuestion[]; responseMode?: 'message' | 'ramu'; grouping?: 'together' | 'independent'; dependsOn?: string }
  | { kind: 'question-state'; requestId: string; answers?: Record<string, string>; drafts?: Record<string, string>; waiting?: boolean; reason?: string }
  | { kind: 'recovery'; state: 'resumed' }
  | { kind: 'request-resolved'; requestId: string; outcome: string }
  | { kind: 'result'; isError: boolean; text: string; costUsd: number | null }
  | { kind: 'compaction'; state: 'started' | 'completed' | 'failed'; beforeTokens?: number; afterTokens?: number }
  | { kind: 'error'; message: string }
  | { kind: 'state'; state: AgentSessionState }
  | { kind: 'settings'; settings: AgentSettings; reason: string; handoff: boolean; previous?: AgentSettings }
  | ({ kind: 'agent' } & AgentTask)

export type PermissionReply = { requestId: string; allow: boolean; message?: string }
export type QuestionReply = { requestId: string; answers: Record<string, string> }

// ---- UI persistence ----

export type ViewDescriptor =
  | { kind: 'agent'; id: string; sessionId: string; repoId?: string; sourceSeq?: number; sourceRequestId?: string }
  | { kind: 'file'; id: string; repoId: string; path: string; preview?: boolean; selection?: { line: number; column: number; endColumn: number; requestId: string } }
  | { kind: 'diff'; id: string; repoId: string; path: string; staged: boolean; stash?: boolean; oid?: string; preview?: boolean }
  | { kind: 'git'; id: string; repoId: string; title: string; oid?: string; preview?: boolean }
  | { kind: 'review'; id: string; repoId?: string; reviewId: string; taskId: string; fileId?: string; threadId?: string; requestId?: string }
  /** Without a repoId the terminal starts where the task's agent runs (the workspace). */
  /** A project action's terminal carries its name and command; the command runs once, right after `runAt`, and not again when the view is restored. */
  | { kind: 'terminal'; id: string; repoId?: string; title?: string; command?: string; runAt?: number }

export interface TaskUiState {
  terminalGroups?: TerminalGroup[]
  views: ViewDescriptor[]
  /** Active editor or conversation tab. */
  activeViewId: string | null
  /** Last focused conversation, kept visible beside the workspace. */
  activeAgentViewId?: string | null
  /** Last editor tab shown before the workspace was hidden, so reopening returns to it. */
  lastWorkspaceViewId?: string | null
  /** The terminal panel was open when the workspace was hidden; reopen it with the workspace. */
  restoreTerminal?: boolean
  /** Dock width in px when files are open beside the conversation. */
  dockWidth?: number
  /** Legacy sidebar visibility, retained for saved profiles; main chat is always visible. */
  dockHidden?: boolean
  activeTerminalId?: string | null
  terminalOpen?: boolean
  terminalLayout?: 'tabs' | 'horizontal' | 'vertical'
  terminalTabPosition?: 'top' | 'right'
  terminalHeight?: number
  /** Docking location, independent of terminal group/tab layout. */
  terminalDock?: 'right' | 'bottom'
}

export interface TerminalGroup {
  id: string
  terminalIds: string[]
  layout: 'horizontal' | 'vertical'
}

export interface WorkspaceUiState {
  openTaskIds: string[]
  activeTaskId: string | null
  sidebar: 'projects' | 'explorer' | 'search' | 'scm' | 'schedules'
  /** Sidebar sections and projects the user folded (`section:pinned`, `project:<id>`); everything else is open. */
  collapsed?: string[]
  /** What the right-side toggle hid (tool panel and/or workspace), restored when it is toggled back. */
  hiddenRight?: { tool: 'explorer' | 'search' | 'scm' | null; workspace: boolean }
}

export interface GitCommit {
  oid: string
  shortOid: string
  author: string
  timestamp: number
  subject: string
  refs: string
  /** Not yet on the branch's upstream. */
  outgoing?: boolean
}
export interface GitBranchInfo { name: string; current: boolean; upstream: string; worktree: string }
export interface CommitDraft { message: string; fingerprint: string; provider: AgentProvider; model: string }

export interface GitCommitFile { path: string; origPath?: string; status: string }
export interface GitStash { oid: string; ref: string; subject: string }

export interface ModelStep { id: string; name: string; provider: AgentProvider; model: string; effort: ReasoningEffort | null }
export interface ModelSet { id: string; name: string; steps: ModelStep[] }
export interface ModelPreferences { defaultBarMode?: 'effort' | 'model'; sets: ModelSet[]; defaultSetId: string; defaultStepId: string }

export interface SearchOptions { query: string; caseSensitive: boolean; wholeWord: boolean; regex: boolean; include: string; exclude: string; repoId?: string }
export interface SearchMatch { repoId: string; path: string; line: number; column: number; endColumn: number; text: string; start: number; end: number }
export interface SearchResults { matches: SearchMatch[]; limited: boolean }
export interface ReplaceFilePreview { repoId: string; path: string; hash: string; count: number; before: string; after: string }

export interface AppPreferences {
  language: 'system' | 'en' | 'id'
  recapsEnabled: boolean
  recapTime: string
  accent: 'blue' | 'violet' | 'teal'
  fontFamily: 'system' | 'geist'
  fontSize: number
  editorFontSize: number
  terminalFontSize: number
  previewTabs: boolean
  hideEmptyStaged: boolean
  /** How Pull and Sync integrate incoming commits. */
  pullMode: PullMode
  autoPull: boolean
  /** Wording rules for AI-drafted commit messages. */
  commitStyle: CommitStyle
  /** Used when commitStyle is custom. */
  commitInstructions: string
  /** Last reusable action selected in Source Control's commit menu. */
  defaultCommitAction: CommitAction
  /** Primary choice when committing from the default branch. */
  defaultCommitBranch: 'new-branch' | 'current'
  recentChats: number
  /** Archived chats idle this many days are deleted automatically; 0 keeps them forever. */
  cleanupArchivedDays: number
  terminalTabPosition: 'top' | 'right'
  defaultAccess: AgentSettings['access']
  defaultAutoFallback: boolean
  busyMessageAction: 'queue' | 'steer'
  /** Send the files open in editor tabs along with each message. */
  includeTabContext: boolean
  /** Dragged width of the sidebar, in px. */
  sidebarWidth: number
  messageBehaviorVersion: 4
  defaultChatDockOpen: boolean
  /** Starred models, as `provider:model-id`; they get their own tab and ⌘1–⌘9 shortcuts in the model picker. */
  favoriteModels: string[]
  /** Tell me when an agent finishes, needs input or fails: a system notification when Ramu is in the background, a toast when it is open. */
  notifyAgentDone: boolean
  /** Resume interrupted chats when the background service starts again. */
  resumeChatsOnRestart: boolean
  asyncQuestions: boolean
  /** Seconds a Claude command may run in the foreground before Ramu moves it to the background; 0 leaves it to the agent. */
  autoBackgroundSeconds: number
  providerBinaries: ProviderConfiguration
  providerUpdateChecks: boolean
  appUpdateChecks: boolean
  appAutoUpdate: boolean
  /** Sidebar chat list: one flat list by recent activity, with project names, instead of groups per project. */
  recentChatMode: boolean
  /** Render text with thin grayscale antialiasing instead of the macOS default. */
  fontSmoothing: boolean
  /** Disable interface animations in addition to the system motion preference. */
  reduceMotion: boolean
  keepAwake: boolean
  keepAwakeWhen: 'plugged-in' | 'always'
  /** Show the 5-hour and weekly plan usage gauges. */
  showUsageLimits: boolean
  fallback: FallbackPreferences
  subagents: SubagentPreferences
  advisor: AdvisorPreferences
  goals: GoalPreferences
  intelligence: IntelligencePreferences
  memory: MemoryPreferences
}

export interface MemoryPreferences {
  /** Agents of every provider read and write Ramu's shared memory. */
  enabled: boolean
  /** Periodically consolidate memories with a model: merge duplicates, resolve contradictions and retire stale notes. */
  dream: boolean
  /** Unused, low-importance memories are archived after this many days. */
  staleAfterDays: number
}
export const DEFAULT_MEMORY_PREFERENCES: MemoryPreferences = { enabled: true, dream: true, staleAfterDays: 90 }
export const MEMORY_KINDS = ['user', 'feedback', 'project', 'reference'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]
/** A durable note shared by every provider. projectId null means it applies everywhere. */
export interface Memory {
  id: string
  projectId: string | null
  kind: MemoryKind
  title: string
  content: string
  tags: string[]
  /** 1 (minor) to 4 (important) drive ranking and decay. 5 (essential) is set only by the user: never forgotten, always given to agents in full. */
  importance: number
  status: 'active' | 'archived'
  /** Why it was archived: stale, merged, contradicted, forgotten by an agent or by the user. */
  archivedReason: string | null
  /** Who created it. confirmed: the user wrote the current text, so it is never forgotten automatically and is quoted in agent instructions. */
  source: { actor: 'user' | 'agent' | 'dream'; provider?: AgentProvider; sessionId?: string; taskId?: string; confirmed?: boolean; eventSeq?: number }
  createdAt: number
  updatedAt: number
  lastUsedAt: number | null
  useCount: number
  expiresAt: number | null
}
export interface MemoryInput { projectId: string | null; kind: MemoryKind; title: string; content: string; tags?: string[]; importance?: number; expiresAt?: number | null }
export interface MemorySnapshot { memories: Memory[]; dreamedAt: number | null; dreaming: boolean; error: string | null }

export interface GoalPreferences {
  mode: 'auto' | 'manual'
  /** Automatic follow-up turns per goal; null means unlimited. Initial and user turns do not count. */
  maxTurns: number | null
}
export const DEFAULT_GOAL_PREFERENCES: GoalPreferences = { mode: 'auto', maxTurns: 10 }
export interface ChatGoal {
  id: string
  objective: string
  status: 'active' | 'completed' | 'blocked' | 'paused' | 'turn-limit' | 'waiting-provider'
  turns: number
  reason: string
  updatedAt: number
  retryAt?: number
  retryDelay?: number
}

// ---- Usage limits, fallback and sub-agent routing ----

/** One plan usage window as the provider last reported it. Account-wide, not per chat. */
export interface UsageReading {
  provider: AgentProvider
  accountId?: string
  window: 'five_hour' | 'weekly'
  /** Set for a model-specific window, e.g. Claude's Opus weekly limit. */
  scope?: string
  /** 0–100. */
  usedPercent: number
  resetsAt?: number
  status: 'ok' | 'warning' | 'limited'
  plan?: string
  updatedAt: number
}

/** A provider, model, effort and service tier to continue with. */
export interface FallbackStep { id: string; provider: AgentProvider; model: string; effort: ReasoningEffort | null; serviceTier?: 'standard' | 'fast' }
/** Percent of a usage window at which Ramu moves on; null waits for the limit itself. */
export type SwitchThreshold = 80 | 90 | 95 | null
export interface FallbackPreferences {
  switchAt: SwitchThreshold
  /** Go back to the original step once its limit resets. */
  returnAfterReset: boolean
  /** Ordered fallback steps per provider. A missing provider uses the built-in default (Claude ↔ Codex). */
  chains: Partial<Record<AgentProvider, FallbackStep[]>>
}
export interface SubagentPreferences {
  /** native: each provider's own sub-agents. single: all run on one step. per-provider: a step (or native) per provider. */
  mode: 'native' | 'single' | 'per-provider'
  single: FallbackStep | null
  /** null means native for that provider. */
  perProvider: Partial<Record<AgentProvider, FallbackStep | null>>
  /** Optional routing by sub-agent type (Explore, Plan, …); null keeps native. Checked before the mode. */
  byType: { id: string; type: string; step: FallbackStep | null }[]
  /** same: a sub-agent walks the main fallback chain of its provider. separate: its own chains. */
  fallback: 'same' | 'separate'
  chains: Partial<Record<AgentProvider, FallbackStep[]>>
  /** 'same' follows the main switch threshold. */
  switchAt: SwitchThreshold | 'same'
  /** Restart native sub-agents that hit a limit on the fallback chain. */
  continueNative: boolean
  /** Give each writing sub-agent its own worktree. */
  isolate: boolean
  /** Codex only: let a hook ask Ramu before Codex's own sub-agents start. Needs a one-time trust entry in Codex's config. */
  codexHook: boolean
  maxConcurrent: number
  /** Attach the parent chat's recent transcript to a sub-agent's prompt. */
  shareContext: boolean
}
/** Ramu's advisor: a model on any provider that main chat agents can consult. While on, Claude Code's own advisor is off in Ramu's Claude chats. */
export interface AdvisorPreferences {
  enabled: boolean
  step: FallbackStep | null
  /** Agents always wait for advice; otherwise they may keep doing work the advice cannot change. */
  wait: boolean
}
export const DEFAULT_ADVISOR_PREFERENCES: AdvisorPreferences = { enabled: false, step: null, wait: false }
/** Result of an advisor request, as the agent's tool sees it. */
export interface AdviceStatus { requestId: string; status: 'pending' | 'ready' | 'failed'; advice?: string; advisor?: string; error?: string; note?: string }
export const DEFAULT_FALLBACK_PREFERENCES: FallbackPreferences = { switchAt: null, returnAfterReset: true, chains: {} }
export const DEFAULT_SUBAGENT_PREFERENCES: SubagentPreferences = { mode: 'native', single: null, perProvider: {}, byType: [], fallback: 'same', chains: {}, switchAt: 'same', continueNative: true, isolate: false, codexHook: false, maxConcurrent: 3, shareContext: false }

/** How much of the model's context window a chat uses right now. */
export interface ContextUsage { used: number; max: number; percent: number; at: number }

/** A side question about the chat, answered without touching the main conversation. */
export interface AsideMessage { id: string; role: 'user' | 'assistant'; text: string; at: number; provider?: AgentProvider; model?: string; error?: boolean }
export interface Aside { id: string; sessionId: string; quote: string; quoteFrom: 'assistant' | 'user'; messages: AsideMessage[]; createdAt: number }
export const DEFAULT_SIDEBAR_WIDTH = 268
export const SIDEBAR_WIDTH_RANGE = [200, 520] as const
export const DEFAULT_APP_PREFERENCES: AppPreferences = { language: 'system', recapsEnabled: true, recapTime: '08:00', accent: 'violet', fontFamily: 'system', fontSize: 14, fontSmoothing: true, reduceMotion: false, recentChatMode: false, editorFontSize: 14, terminalFontSize: 14, previewTabs: true, hideEmptyStaged: true, pullMode: 'rebase', autoPull: true, commitStyle: 'conventional', commitInstructions: '', defaultCommitAction: 'commit', defaultCommitBranch: 'new-branch', recentChats: 10, cleanupArchivedDays: 90, terminalTabPosition: 'top', defaultAccess: 'auto', defaultAutoFallback: true, defaultChatDockOpen: true, favoriteModels: [], notifyAgentDone: true, resumeChatsOnRestart: true, asyncQuestions: true, autoBackgroundSeconds: 60, providerBinaries: {}, providerUpdateChecks: true, appUpdateChecks: true, appAutoUpdate: false, keepAwake: false, keepAwakeWhen: 'plugged-in', showUsageLimits: true, fallback: DEFAULT_FALLBACK_PREFERENCES, subagents: DEFAULT_SUBAGENT_PREFERENCES, advisor: DEFAULT_ADVISOR_PREFERENCES, goals: DEFAULT_GOAL_PREFERENCES, memory: DEFAULT_MEMORY_PREFERENCES, intelligence: DEFAULT_INTELLIGENCE_PREFERENCES, includeTabContext: true, sidebarWidth: DEFAULT_SIDEBAR_WIDTH, busyMessageAction: 'steer', messageBehaviorVersion: 4 }


/** Internal scope ID; omitted from the user project list. */
export const NO_PROJECT = 'no-project'
export interface SkillInfo { name: string; description: string; path: string }
export interface FileContext {
  repoId: string
  path: string
  content?: string
  /** Other open tabs are references; their content is fetched only when the agent needs it. */
  referenceOnly?: boolean
  selection?: { startLine: number; startColumn: number; endLine: number; endColumn: number; side?: 'original' | 'modified' }
  diff?: { staged: boolean; oid?: string; stash?: boolean }
  source: 'tab' | 'mention'
}
/** The per-chat tool server a provider connects to. `nativeSubagents: false` turns the provider's own sub-agent tools off so Ramu's `ramu_agent` is used instead. */
export interface McpConnection { url: string; token: string; nativeSubagents?: boolean; instructions?: string; /** Codex only: a hook asks Ramu before each of Codex's own sub-agents starts, so Ramu can send it elsewhere. */ interceptSubagents?: boolean }
export type ScheduleRule =
  | { kind: 'once'; at: string }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; time: string; weekdays: number[] }
  | { kind: 'monthly'; time: string; day: number }
  | { kind: 'interval'; minutes: number; anchor: string }
export interface ScheduleInput {
  name: string; prompt: string; projectId: string; workspaceId?: string | null
  sourceTaskId?: string | null; timezone: string; rule: ScheduleRule
  missedPolicy: 'latest' | 'skip'; settings: AgentSettings
}
export interface Schedule extends ScheduleInput {
  id: string; state: 'active' | 'paused' | 'completed'; nextRunAt: number | null; createdAt: number
}
export interface ScheduleRun {
  id: string; scheduleId: string; dueAt: number; taskId: string | null; sessionId: string | null
  status: 'queued' | 'running' | 'needs-input' | 'completed' | 'failed' | 'missed' | 'interrupted'
  attempts: number; retryAt: number | null; error: string | null; createdAt: number
}
export interface RecapItem {
  id: string; key: string; group: 'attention' | 'recent'; title: string; detail: string
  taskId: string; sessionId: string; sourceSeq: number
  status: 'open' | 'done' | 'dismissed' | 'snoozed'; snoozedUntil: number | null; updatedAt: number
}
export interface RecapSnapshot { items: RecapItem[]; generatedAt: number | null; generating: boolean; error: string | null }
export interface BackgroundStatus { running: boolean; pid: number; startedAt: number; loginEnabled: boolean; version?: string; build?: string; bundledVersion?: string; bundledBuild?: string; updateAvailable?: boolean }

export interface ChangeFile {
  id: string; repoId: string; repoName: string; path: string
  status: 'added' | 'modified' | 'deleted'; binary: boolean
  oldContent: string; newContent: string
  oldHash?: string; newHash?: string
  oldMode?: number
  addedLines?: number; removedLines?: number
}
/** Branch context for a saved run; the diff itself remains a before/after snapshot. */
export interface ReviewBranchState {
  repoId: string; repoName: string
  currentBranch: string | null; targetBranch: string | null; recordedBranch: string | null
}
/** Live state is separate from the immutable run snapshot. */
export interface ReviewFileState {
  fileId: string
  state: 'unchanged' | 'changed' | 'moved' | 'missing' | 'deleted' | 'unavailable'
  currentPath?: string
  checkoutChanged?: boolean
  recordedBranch?: string
  currentBranch?: string
  reason?: string
  newerReview?: { id: string; taskId: string; fileId: string }
  outdatedCommentIds?: string[]
}
export interface ReviewReply { id: string; author?: 'human' | 'ai'; text: string; createdAt: number; state: 'draft' | 'sent' }
export interface ReviewComment {
  id: string; fileId: string; side: 'old' | 'new'; line: number; endLine: number
  readyToSend?: boolean; sentAt?: number; resolutionSuggestion?: { text: string; createdAt: number }
  scope?: 'file' | 'line'; kind?: 'comment' | 'note' | 'question' | 'finding'; replies?: ReviewReply[]
  text: string; author: 'human' | 'ai'; severity?: 'high' | 'medium' | 'low'
  state: 'draft' | 'sent' | 'resolved'; createdAt: number
}
export interface ChangeReview {
  id: string; taskId: string; sessionId: string | null; createdAt: number
  state: 'recording' | 'ready' | 'failed'; error: string | null
  files: ChangeFile[]; comments: ReviewComment[]
  aiState: 'idle' | 'running' | 'completed' | 'failed'; aiSummary: string | null
  startSeq?: number; endSeq?: number; reviewedAt?: number | null
  undoneAt?: number | null; undoFileIds?: string[]
}
export interface UndoFile { fileId: string; path: string; repoName: string; status: 'ready' | 'conflict' | 'unchanged' | 'unavailable'; reason: string; currentContent: string; resultContent: string; remove: boolean }
export interface UndoPreview { token: string; reviewId: string; expiresAt: number; files: UndoFile[] }

/** Branch choice captured before a commit, checked again under the repository lock. */
export interface CommitBranchOptions { expectedBranch: string | null; newBranch?: string }
