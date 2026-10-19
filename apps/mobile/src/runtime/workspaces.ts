import type { CreateTaskInput, WorktreePlanEntry } from '@ramu/shared/types'
import type { BranchNamingIntent } from '@ramu/shared/workspaceDefaults'

/** Freeze the selected checkout in the outbox; delivery must never substitute a new worktree. */
export function workspaceCreation(input: {
  projectId: string
  title: string
  requestId: string
  checkout?: 'current' | 'worktree'
  workspaceId?: string
  branchPrefix?: string
  branchNaming?: BranchNamingIntent
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
  }
}

/** The server allocates/validates new worktrees; reuse never requests a speculative plan. */
export async function createWorkspaceTask<T>(
  input: CreateTaskInput,
  plan: () => Promise<WorktreePlanEntry[]>,
  create: (input: CreateTaskInput, plan?: WorktreePlanEntry[]) => Promise<T>,
): Promise<T> {
  return create(input, input.mode === 'worktree' && !input.workspaceId ? await plan() : undefined)
}

export type WorkspaceChoice = { mode: 'current' | 'worktree' | null; workspaceId?: string; name?: string }

/** Additive sidecar: old text/attachment/mention drafts keep their original keys. */
export function readWorkspaceChoice(text?: string): WorkspaceChoice {
  try {
    const value = JSON.parse(text ?? 'null')
    if (value?.version !== 1 || ![null, 'current', 'worktree'].includes(value.mode)) return { mode: null }
    if (
      value.workspaceId !== undefined &&
      (value.mode !== 'worktree' || typeof value.workspaceId !== 'string' || !value.workspaceId)
    )
      return { mode: null }
    return {
      mode: value.mode,
      workspaceId: value.workspaceId,
      name: typeof value.name === 'string' ? value.name : undefined,
    }
  } catch {
    return { mode: null }
  }
}
