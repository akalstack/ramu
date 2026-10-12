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
}

export type BindingSetupState = 'ready' | 'pending' | 'failed'

/** Task + repository + mode + the working directory every surface must use. */
export interface RepositoryBinding {
  /** A plain chat folder supports files and terminals, without Git controls. */
  folderOnly?: boolean
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

/** Result of running the project's formatter on an editor buffer. `tool` is null when the project has none. */
export interface FormatResult { tool: string | null; label: string | null; content: string | null; error: string | null }
export interface LintDiagnostic { tool: string; severity: 'error' | 'warning' | 'info'; message: string; code: string | null; url: string | null; line: number; column: number; endLine: number; endColumn: number }
/** `live` tools lint the unsaved buffer; the rest only describe the saved file. */
export interface LintResult { tools: { id: string; label: string; live: boolean }[]; diagnostics: LintDiagnostic[]; errors: string[] }
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

export type DiffSide = 'HEAD' | 'INDEX' | 'WORKTREE'

export interface DiffContents {
  original: string
  modified: string
}

// ---- Agent ----

export type AgentProvider = 'claude-code' | 'codex' | 'opencode' | 'cursor' | 'antigravity'
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
export interface AgentSettings {
  provider: AgentProvider
  /** Empty means the provider's default. */
  model: string
  effort: ReasoningEffort | null
  serviceTier?: 'standard' | 'fast'
  access: 'edits' | 'auto' | 'full'
  autoFallback: boolean
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
export const DEFAULT_AGENT_SETTINGS: AgentSettings = { provider: 'claude-code', model: '', effort: null, access: 'full', autoFallback: true, serviceTier: 'standard' }

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

export interface TodoItem { text: string; status: 'pending' | 'active' | 'done' }
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
type AgentEventBody =
  | { kind: 'goal'; goal: ChatGoal | null }
  | { kind: 'schedule'; schedule: Schedule }
  | { kind: 'queue'; messages: QueuedMessage[]; paused?: boolean }
  | { kind: 'user'; text: string; attachments?: Attachment[] }
  | { kind: 'file-restore'; userSeq: number; fileCount: number }
  | { kind: 'init'; model: string; cwd: string; providerSessionId: string; provider?: AgentProvider }
  | { kind: 'text'; text: string; messageId?: string; nativeMessageId?: string }
  | { kind: 'tool-use'; toolUseId: string; name: string; summary: string }
  | { kind: 'tool-result'; toolUseId: string; isError: boolean; summary: string; running?: boolean }
  | { kind: 'turn-diff'; turnId: string; diff: string }
  | { kind: 'permission-request'; requestId: string; toolName: string; title: string; detail: string; }
  /** The agent's own checklist (Claude TodoWrite, Codex plan). One event per chat, updated in place. */
  | { kind: 'todos'; items: TodoItem[] }
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
  | { kind: 'agent'; id: string; sessionId: string; repoId?: string; sourceSeq?: number }
  | { kind: 'file'; id: string; repoId: string; path: string; preview?: boolean; selection?: { line: number; column: number; endColumn: number; requestId: string } }
  | { kind: 'diff'; id: string; repoId: string; path: string; staged: boolean; oid?: string; preview?: boolean }
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

/** 1-based lines and columns, as Monaco uses. */
export interface LspRange { startLine: number; startColumn: number; endLine: number; endColumn: number }
export interface LspCompletionItem { label: string; labelDetail: string | null; kind: number; detail: string | null; documentation: string | null; insertText: string; snippet: boolean; range: LspRange | null; sortText: string | null; filterText: string | null; commitCharacters: string[]; deprecated: boolean; raw: unknown }
export interface LspCompletionList { incomplete: boolean; items: LspCompletionItem[] }
export interface LspCompletionDetail { detail: string | null; documentation: string | null; additionalEdits: { range: LspRange; text: string }[] }
export interface LspHover { contents: string[]; range: LspRange | null }
export interface LspSignatureHelp { activeSignature: number; activeParameter: number; signatures: { label: string; documentation: string | null; parameters: { label: string | [number, number]; documentation: string | null }[] }[] }
export interface LspLocation { repoId: string; path: string; range: LspRange }
export interface LspDiagnostic { severity: 'error' | 'warning' | 'info' | 'hint'; message: string; code: string | null; source: string | null; range: LspRange }
export interface LspDiagnostics { cwd: string; path: string; diagnostics: LspDiagnostic[] }
export interface LspStatus { cwd: string; server: string; label: string; state: 'ready' | 'failed'; message: string | null }

export type CompletionProviderId = 'ollama' | 'codestral'
/** Inline (ghost text) completion. Off by default, because a cloud provider receives the code around the cursor. */
/** An empty `ollamaModel` means the model recommended for this machine; models are kept per provider so they cannot cross over. */
export interface AiCompletionPreferences { enabled: boolean; provider: CompletionProviderId; ollamaModel: string; codestralModel: string; codestralUrl: string; nextEdit: boolean; /** The user has confirmed that Codestral may receive the file being edited for next-edit predictions. */ nextEditAck: boolean }
/** `taskId`/`repoId` let the main process read files the current file imports; `context` holds the user's other open files. */
export interface CompletionRequest { requestId: string; taskId: string; repoId: string; path: string; prefix: string; suffix: string; context: { path: string; content: string }[] }
export interface CompletionResult { text: string; status: 'ok' | 'disabled' | 'no-key' | 'rate-limited' | 'unavailable' | 'skipped'; message: string | null; retryAfterMs: number | null }
export interface HardwareInfo { platform: string; arch: string; chip: string; memoryGb: number; unifiedMemory: boolean; gpu: string | null; gpuMemoryGb: number | null }
/** How well a local model suits this machine: `recommended` is Ramu's pick, `tight` may crowd memory, `too-large` is not advised. */
export interface OllamaModelOption { id: string; label: string; sizeGb: number; note: string; fit: 'recommended' | 'fits' | 'tight' | 'too-large'; installed: boolean; curated: boolean }
export interface NextEditRequest { requestId: string; path: string; lines: string[]; cursorLine: number; edits: { line: number; before: string[]; after: string[] }[] }
export interface NextEditResult { status: 'ok' | 'disabled' | 'unavailable' | 'skipped'; edit: { startLine: number; endLine: number; text: string } | null; message: string | null }
export interface CompletionStatus { hasKey: boolean; keyHost: string | null; ollama: { running: boolean; models: string[] }; hardware: HardwareInfo; recommended: string; options: OllamaModelOption[] }
export interface PullProgress { model: string; status: string; completed: number; total: number; done: boolean; error: string | null }

export interface AppPreferences {
  language: 'system' | 'en' | 'id'
  recapsEnabled: boolean
  recapTime: string
  accent: 'blue' | 'violet' | 'teal'
  fontFamily: 'system' | 'geist'
  fontSize: number
  editorFontSize: number
  formatOnSave: boolean
  languageServers: boolean
  aiCompletion: AiCompletionPreferences
  lintWhileEditing: boolean
  terminalFontSize: number
  previewTabs: boolean
  hideEmptyStaged: boolean
  /** How Pull and Sync integrate incoming commits. */
  pullMode: PullMode
  /** Wording rules for AI-drafted commit messages. */
  commitStyle: CommitStyle
  /** Used when commitStyle is custom. */
  commitInstructions: string
  recentChats: number
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
  /** Show the 5-hour and weekly plan usage gauges. */
  showUsageLimits: boolean
  fallback: FallbackPreferences
  subagents: SubagentPreferences
  advisor: AdvisorPreferences
  goals: GoalPreferences
}

export interface GoalPreferences {
  mode: 'auto' | 'manual' | 'off'
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
export const DEFAULT_FALLBACK_PREFERENCES: FallbackPreferences = { switchAt: 90, returnAfterReset: false, chains: {} }
export const DEFAULT_SUBAGENT_PREFERENCES: SubagentPreferences = { mode: 'native', single: null, perProvider: {}, byType: [], fallback: 'same', chains: {}, switchAt: 'same', continueNative: true, isolate: false, codexHook: false, maxConcurrent: 3, shareContext: false }

/** How much of the model's context window a chat uses right now. */
export interface ContextUsage { used: number; max: number; percent: number; at: number }

/** A side question about the chat, answered without touching the main conversation. */
export interface AsideMessage { id: string; role: 'user' | 'assistant'; text: string; at: number; provider?: AgentProvider; model?: string; error?: boolean }
export interface Aside { id: string; sessionId: string; quote: string; quoteFrom: 'assistant' | 'user'; messages: AsideMessage[]; createdAt: number }
export const DEFAULT_SIDEBAR_WIDTH = 268
export const SIDEBAR_WIDTH_RANGE = [200, 520] as const
export const DEFAULT_APP_PREFERENCES: AppPreferences = { language: 'system', recapsEnabled: true, recapTime: '08:00', accent: 'violet', fontFamily: 'system', fontSize: 14, editorFontSize: 14, formatOnSave: true, languageServers: true, aiCompletion: { enabled: false, provider: 'ollama', ollamaModel: '', codestralModel: '', codestralUrl: 'https://codestral.mistral.ai', nextEdit: false, nextEditAck: false }, lintWhileEditing: true, terminalFontSize: 14, previewTabs: true, hideEmptyStaged: true, pullMode: 'rebase', commitStyle: 'conventional', commitInstructions: '', recentChats: 5, terminalTabPosition: 'top', defaultAccess: 'full', defaultAutoFallback: true, defaultChatDockOpen: true, favoriteModels: [], notifyAgentDone: true, resumeChatsOnRestart: true, asyncQuestions: true, autoBackgroundSeconds: 60, providerBinaries: {}, providerUpdateChecks: true, showUsageLimits: true, fallback: DEFAULT_FALLBACK_PREFERENCES, subagents: DEFAULT_SUBAGENT_PREFERENCES, advisor: DEFAULT_ADVISOR_PREFERENCES, goals: DEFAULT_GOAL_PREFERENCES, includeTabContext: true, sidebarWidth: DEFAULT_SIDEBAR_WIDTH, busyMessageAction: 'steer', messageBehaviorVersion: 4 }


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
  diff?: { staged: boolean; oid?: string }
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
export interface BackgroundStatus { running: boolean; pid: number; startedAt: number; loginEnabled: boolean }

export interface ChangeFile {
  id: string; repoId: string; repoName: string; path: string
  status: 'added' | 'modified' | 'deleted'; binary: boolean
  oldContent: string; newContent: string
  oldHash?: string; newHash?: string
  oldMode?: number
  addedLines?: number; removedLines?: number
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
