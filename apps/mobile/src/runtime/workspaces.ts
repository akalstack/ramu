import type { CreateTaskInput, WorktreePlanEntry } from '@ramu/shared/types'
import type { BranchNamingIntent, BranchChoice } from '@ramu/shared/workspaceDefaults'
export { readWorkspaceChoice, type WorkspaceChoice } from '@ramu/shared/workspaceDefaults'

/** Freeze the selected checkout in the outbox; delivery must never substitute a new worktree. */
export function workspaceCreation(input: {
  projectId: string
  title: string
  requestId: string
  checkout?: 'current' | 'worktree'
  workspaceId?: string
  branchPrefix?: string
  branchNaming?: BranchNamingIntent
  branchChoice?: BranchChoice
}): CreateTaskInput {
  if (input.workspaceId && input.checkout !== 'worktree')
    throw new Error('An existing workspace requires worktree mode')
  return {
    projectId: input.projectId,
    title: input.title,
    requestId: input.requestId,
    mode: input.checkout ?? 'current',
    workspaceId: input.workspaceId,
    branchPrefix: input.workspaceId ? undefined : input.branchPrefix,
    branchNaming: input.workspaceId ? undefined : input.branchNaming,
    branchChoice: input.workspaceId ? undefined : input.branchChoice,
  }
}

/** The server allocates/validates new worktrees; reuse never requests a speculative plan. */
export async function createWorkspaceTask<T>(
  input: CreateTaskInput,
  plan: () => Promise<WorktreePlanEntry[]>,
  create: (input: CreateTaskInput, plan?: WorktreePlanEntry[]) => Promise<T>,
  reviewedPlan?: WorktreePlanEntry[],
): Promise<T> {
  return create(input, input.mode === 'worktree' && !input.workspaceId ? (reviewedPlan ?? (await plan())) : undefined)
}
