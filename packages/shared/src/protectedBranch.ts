/** Long-lived branches that teams usually protect, besides the repository's default branch. Whole names only: `GENESIS-1-DEV` is a feature branch. */
const PROTECTED_NAMES = new Set([
  'main',
  'master',
  'dev',
  'develop',
  'development',
  'stg',
  'stage',
  'staging',
  'prod',
  'production',
])

/** The default branch, or a branch named like one of the common protected environments. */
export function isProtectedBranch(branch: string | null | undefined, defaultBranch?: string | null): boolean {
  if (!branch) return false
  return branch === defaultBranch || PROTECTED_NAMES.has(branch.toLowerCase())
}
