import type { AgentProvider } from './agent'

export type GitFileState =
  'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'type-changed' | 'untracked' | 'unmerged'

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
export interface GitBranchInfo {
  name: string
  current: boolean
  upstream: string
  worktree: string
}
/** `branch` is a suggested feature branch name, present when one was asked for. */
export interface CommitDraft {
  message: string
  fingerprint: string
  provider: AgentProvider
  model: string
  branch?: string
}

export interface GitCommitFile {
  path: string
  origPath?: string
  status: string
}
export interface GitStash {
  oid: string
  ref: string
  subject: string
}

/** Branch choice captured before a commit, checked again under the repository lock. */
/** `autoBranch` names the new branch on the server, like T3 Code: from `newBranch` when given (an AI suggestion), else the commit subject. */
export interface CommitBranchOptions {
  expectedBranch: string | null
  newBranch?: string
  autoBranch?: boolean
}

/** A conflicted file, as the conflict view shows it. */
export interface ConflictFile {
  path: string
  /** The file's text with its markers; null when it is binary, too large or deleted here. */
  text: string | null
  /** Of the text on disk, so a choice made on a stale view is refused. */
  hash: string | null
  hunks: import('../conflicts').ConflictHunk[]
  /** Whether each side still has the file; false means that side deleted it. */
  current: boolean
  incoming: boolean
  reason: 'binary' | 'too-large' | 'deleted' | null
}
