import type { BranchChoice, BranchNamingIntent } from '../workspaceDefaults'
import type { ChatGoal } from './goal'
import type { ThreadInputSummary } from './agent'
export type CheckoutMode = 'current' | 'worktree'

export interface Project {
  id: string
  name: string
  /** Workspace folder the project was added from; agents run here. Null for legacy projects. */
  root: string | null
  createdAt: number
  /** Other names people use for the project; Auto matches them as whole words. */
  aliases?: string[]
  /** One short line about what the project is, shared with Auto's routing model call. */
  description?: string
}

/** A saved command for a project, run from the window bar in a new terminal at the chat's workspace. */
export interface ProjectAction {
  id: string
  name: string
  command: string
  /** Optional shortcut in Ramu's key format, e.g. `mod+shift+r`. */
  keys?: string
  /** Repository-defined action; absent for a locally saved override. */
  source?: 'ramu.json' | '.ramu/config.json'
}

/** Management includes hidden commands; ordinary action lists and shortcuts exclude them. */
export interface ProjectActionSettings {
  actions: ProjectAction[]
  hiddenIds: string[]
  customOrder: boolean
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
/** What a list needs of a goal: its state and objective, not its evidence or transcript. */
export interface TaskGoalSummary {
  status: Exclude<ChatGoal['status'], 'completed'>
  pausedBy?: ChatGoal['pausedBy']
  objective: string
  /** A completion claim is waiting for, or running, the verification command. */
  verifying?: boolean
  reason?: string
}

export interface Task {
  id: string
  projectId: string
  title: string
  /** Execution-host title work, synchronized across clients. Older hosts omit it. */
  titleGenerationState?: 'idle' | 'pending' | 'complete' | 'failed'
  mode: CheckoutMode
  workspaceId: string | null
  status: TaskStatus
  createdAt: number
  /** When the chat was pinned to the top of the sidebar, or null. */
  pinnedAt: number | null
  /** When the user marked this thread done, or null while it is active. */
  doneAt?: number | null
  /** Latest of creation and the newest agent session start. */
  lastActiveAt: number
  /** Set while every provider is at its usage limit: when Ramu next tries to continue the chat on its own. */
  waitingUntil?: number | null
  /** Naming failed during this thread's initial workspace creation. */
  branchNamingFallback?: boolean | null
  /**
   * The thread's unfinished goal, for list views. Absent from older hosts, which means unknown, not "no goal"; null
   * means there is none (or it is complete).
   */
  goalState?: TaskGoalSummary | null
  /** Unresolved requests from main sessions, including forwarded helper input. Older hosts omit this. */
  inputSummary?: ThreadInputSummary | null
  /** A chat started from a "What Ramu learned" summary; it shows a Review label under Chats. */
  kind?: 'library-review' | null
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
  baseOid?: string

  repoId: string
  repoName: string
  baseRef: string
  taskBranch: string
  path: string
}

export interface CreateTaskInput {
  requestId?: string
  branchPrefix?: string
  branchNaming?: BranchNamingIntent
  branchChoice?: BranchChoice

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

/** Internal scope ID; omitted from the user project list. */
export const NO_PROJECT = 'no-project'
/** Home's Auto choice: no project yet; the first prompt picks one. Never stored on a thread. */
export const AUTO_PROJECT = 'auto-project'
export interface SkillInfo {
  name: string
  description: string
  path: string
}
export interface FileContext {
  repoId: string
  path: string
  content?: string
  /** Other open tabs are references; their content is fetched only when the agent needs it. */
  referenceOnly?: boolean
  selection?: {
    startLine: number
    startColumn: number
    endLine: number
    endColumn: number
    side?: 'original' | 'modified'
  }
  diff?: { staged: boolean | 'all'; oid?: string; stash?: boolean }
  source: 'tab' | 'mention'
}
