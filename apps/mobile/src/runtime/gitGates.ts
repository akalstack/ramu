import type { GitStatus } from '@ramu/shared/types'

export type CommitAction = 'commit' | 'push' | 'sync' | 'amend' | 'branch'

type Gated = Pick<GitStatus, 'oid' | 'branch' | 'detached' | 'upstream' | 'ahead' | 'behind' | 'entries'> &
  Partial<Pick<GitStatus, 'operation' | 'remote'>>

/**
 * What the repository allows right now, by the same rules as the desktop's Source Control panel: no commit with
 * conflicts, no remote action in the middle of a rebase or merge, no undo of the root commit or of a commit that
 * is already on the upstream branch.
 */
export function gitGates(status: Gated | null, commitCount: number) {
  const conflicts = status
    ? status.entries.filter((entry) => entry.staged === 'unmerged' || entry.unstaged === 'unmerged').length
    : 0
  const operation = status?.operation ?? null
  const canRemote = !!status?.branch && !!status.remote && !operation
  return {
    conflicts,
    operation,
    canRemote,
    canAmend: !!status?.oid && !operation && !conflicts,
    canUndo:
      !!status?.oid &&
      commitCount > 1 &&
      !status.detached &&
      !operation &&
      !conflicts &&
      !(status.upstream && status.ahead === 0),
    /** A clean tree with something to sync or publish: the primary button becomes Sync or Publish, like VS Code. */
    syncOnly:
      !!status &&
      !status.entries.length &&
      !operation &&
      !!status.branch &&
      (status.remote ? !status.upstream || status.ahead > 0 || status.behind > 0 : false),
  }
}

/** Why a commit action cannot run, or null when it can. The reason is English copy for the caller to translate. */
export function commitBlock(
  action: CommitAction,
  gates: ReturnType<typeof gitGates>,
  changes: number,
  hasHead: boolean,
): string | null {
  if (gates.operation) return 'Finish the rebase or merge in progress first.'
  if (gates.conflicts) return 'Resolve conflicts before committing.'
  if (action === 'amend') return hasHead ? null : 'There is no commit to amend yet.'
  if (!changes) return 'No changes in this checkout.'
  if ((action === 'push' || action === 'sync') && !gates.canRemote) return 'This branch has no remote to push to.'
  return null
}

/** The action to start with: the computer's saved default, falling back to a plain commit when it cannot run. */
export function startingAction(saved: unknown, gates: ReturnType<typeof gitGates>): CommitAction {
  return (saved === 'push' || saved === 'sync') && gates.canRemote ? saved : 'commit'
}
