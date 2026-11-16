import type { BranchChoice, BranchNamingIntent } from '../workspaceDefaults'
import type { ChatGoal } from './goal'
import type { AgentProvider, AgentSessionState, ThreadHelperSummary, ThreadInputSummary } from './agent'
export type CheckoutMode = 'current' | 'worktree'

export interface Project {
  id: string
  name: string
  /** Workspace folder the project was added from; agents run here.  */
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

/** A project-level chat. */
/** What a list needs of a goal: its state and objective, not its evidence or transcript. */
export interface TaskGoalSummary {
  status: Exclude<ChatGoal['status'], 'completed'>
  pausedBy?: ChatGoal['pausedBy']
  objective: string
  /** The main session that owns the goal, so a list can open it exactly. Older hosts omit it. */
  sessionId?: string
  /** A completion claim is waiting for, or running, the verification command. */
  verifying?: boolean
  verificationFailed?: boolean
  reason?: string
}

export type TitleSource = 'prompt' | 'ai' | 'provider' | 'manual'

export interface Task {
  id: string
  projectId: string
  title: string
  /** Execution-host title work, synchronized across clients. Older hosts omit it. */
  titleGenerationState?: 'idle' | 'pending' | 'complete' | 'failed'
  /**
   * Where the title came from: the first message, a model Ramu asked, the provider's own name for the session, or the
   * person. A manual title is never replaced. Older hosts omit it.
   */
  titleSource?: TitleSource
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
   * The thread's unfinished goal, for list views. Null
   * means there is none (or it is complete).
   */
  goalState?: TaskGoalSummary | null
  /**
   * Every agent that has worked in the thread (model handoffs and teammates), oldest first, the leading one last. Only
   * the task list sets it; older hosts omit it.
   */
  providers?: AgentProvider[]
  /** Unresolved requests from main sessions, including forwarded helper input. Older hosts omit this. */
  inputSummary?: ThreadInputSummary | null
  /** Independent helper work after the parent goes idle. Null means none. */
  helperSummary?: ThreadHelperSummary | null
  /** Settled advisor consultations nobody has opened yet; absent when none. */
  unreadAdvice?: number
  /**
   * When the host read this task, never moving backwards. A client keeps the newer of two reads of the same task, so a
   * late response cannot bring back stopped or completed work..
   */
  snapshotAt?: number
  /** Latest root execution outcome. */
  executionState?: AgentSessionState
  /** A chat started from a "What Ramu learned" summary; it shows a Review label under Chats. */
  kind?: 'library-review' | null
  /** The schedule whose run created this thread. Null for every other thread. */
  scheduleId?: string | null
  /**
   * Who started this thread, when an agent, a continuation or a terminal did: the starting thread, or null when it
   * has none here. Absent for threads a person started.
   */
  startedFrom?: ThreadOrigin | null
  /** The pull request for the thread's branch, from the host's last look; absent when there is none or it is unknown. */
  pullRequest?: import('./forge').TaskPullRequest | null
  /**
   * Where the thread's work lands: its worktree's branch, or the branch its project's checkout has out. Only the task
   * list sets it; null when there is none (no project, a plain folder, detached), and older hosts omit it.
   */
  branch?: string | null
}

export interface ThreadOrigin {
  groupId: string
  taskId: string | null
  title: string | null
  /** The other host whose agent started this thread; `title` then names its thread there. Absent for local origins. */
  host?: string | null
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
  /**
   * The branch a current-checkout binding has checked out now, so lists can say where a thread's work lands; null when
   * detached. Only the task's bindings list sets it, and older hosts omit it.
   */
  checkedOut?: string | null
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
  /** Start from this branch on the remote, fetched first, instead of the repository's current branch. */
  baseBranch?: string

  /**
   * Work on an existing branch instead of a new one, in a new worktree: a pull request's head. `fetchRef` names the
   * remote ref to fetch when the branch is not on the remote under its own name (a pull request from a fork).
   */
  checkout?: { repoId: string; branch: string; fetchRef?: string }
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

/** One item of a copy between hosts. `path` starts with the chosen item's own name and uses POSIX separators. */
export interface TransferEntry {
  /** Which chosen item this belongs to, in the order they were chosen. */
  root: number
  path: string
  kind: 'file' | 'dir' | 'link'
  size: number
  /** Permission bits, so scripts stay executable. */
  mode: number
  /** A link's target, recreated as written. */
  target?: string
}

export interface TransferManifest {
  entries: TransferEntry[]
  bytes: number
}

/** Up to one chunk of a file, base64-encoded and gzipped when that made it meaningfully smaller. */
export interface TransferChunk {
  data: string
  gzip: boolean
  /** Bytes of the file this chunk covers, before compression. */
  bytes: number
}

/** What a copy reads from: items in a project on that host, or absolute paths on that host (a desktop drop). */
export type TransferSource = { taskId: string; repoId: string; paths: string[] } | { paths: string[] }

/** Where a copy lands: a folder of a project, or that host's Downloads folder. */
export type TransferTarget = { taskId: string; repoId: string; dir: string } | { downloads: true }

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
