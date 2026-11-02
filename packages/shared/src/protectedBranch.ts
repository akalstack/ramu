/** Long-lived branches that teams usually protect, besides the repository's default branch. Whole names only: `PROJ-1-DEV` is a feature branch. */
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

/** Approval belongs to the exact local branch and commit reviewed by the user. */
export interface SyncApproval {
  branch: string
  oid: string
  targetBranch: string
}
const SYNC_CONFIRMATION = 'Protected branch confirmation required: '
export const syncConfirmationMessage = (approval: SyncApproval) => SYNC_CONFIRMATION + JSON.stringify(approval)
export function readSyncConfirmation(error: unknown): SyncApproval | null {
  const message = error instanceof Error ? error.message : String(error)
  const start = message.indexOf(SYNC_CONFIRMATION)
  if (start < 0) return null
  try {
    const value = JSON.parse(message.slice(start + SYNC_CONFIRMATION.length)) as Partial<SyncApproval>
    return typeof value.branch === 'string' &&
      value.branch.length > 0 &&
      typeof value.targetBranch === 'string' &&
      value.targetBranch.length > 0 &&
      typeof value.oid === 'string' &&
      /^[a-f0-9]{40,64}$/.test(value.oid)
      ? { branch: value.branch, oid: value.oid, targetBranch: value.targetBranch }
      : null
  } catch {
    return null
  }
}
