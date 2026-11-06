/** The pending confirmation (or name prompt) shown in the repository dialog. */
export type Confirmation =
  | { kind: 'discard'; paths: string[] }
  | { kind: 'undo'; oid: string; title: string }
  | { kind: 'branch' }
  | { kind: 'branch-from'; from: string }
  | { kind: 'rename-branch' }
  | { kind: 'merge'; name: string }
  | { kind: 'stash'; staged?: boolean }
  | { kind: 'delete-branch'; name: string }
  | { kind: 'drop-stash'; oid: string; title: string }

export type GitTab = 'commits' | 'stashes' | 'pulls'

/** Runs a Git operation under the repository's busy flag, reports failures and refreshes. */
export type GitRun = (fn: () => Promise<unknown>) => Promise<void>
