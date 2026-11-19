import type { AppPreferences, CommitBranchOptions } from '@ramu/shared/types'

/**
 * Commit & Push or Commit & Sync on the repository's default branch asks first, as on the desktop: a feature branch or
 * this one, with the host's Commit branch setting as the first choice. Elsewhere the commit goes where it is.
 */
export function commitBranchQuestion(
  action: string,
  info: { branch: string | null; defaultBranch: string | null },
  preference: AppPreferences['defaultCommitBranch'] | undefined,
): { branch: string; first: 'new' | 'current' } | null {
  if (action !== 'push' && action !== 'sync') return null
  if (!info.branch || info.branch !== info.defaultBranch) return null
  return { branch: info.branch, first: preference === 'current' ? 'current' : 'new' }
}

/** What the commit is told once the person has chosen. */
export const commitBranchOptions = (branch: string, choice: 'new' | 'current'): CommitBranchOptions =>
  choice === 'new' ? { expectedBranch: branch, autoBranch: true } : { expectedBranch: branch }
