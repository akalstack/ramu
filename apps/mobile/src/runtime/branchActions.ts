import type { GitBranchInfo, GitStatus } from '@ramu/shared/types'
import { validBranchName } from '@ramu/shared/workspaceDefaults'
import type { useStore } from './store'

type Invoke = ReturnType<typeof useStore>['invoke']

export type BranchAction =
  | { kind: 'merge'; name: string }
  | { kind: 'create-from'; name: string; from: string }
  | { kind: 'rename'; name: string }
  | { kind: 'delete'; name: string }

/** What the branch actions read from the repository: its branches and the checkout's state. */
export interface BranchContext {
  canWrite: boolean
  status: Pick<GitStatus, 'branch' | 'entries'> & Partial<Pick<GitStatus, 'operation'>>
  branches: Pick<GitBranchInfo, 'name' | 'current' | 'worktree'>[]
}

/**
 * Branches that can be deleted from here: never the checked-out one, nor one another worktree has checked out, as the
 * desktop's Delete branch… lists them. Git itself keeps a branch that is not merged yet.
 */
export const deletableBranches = (context: BranchContext) =>
  context.branches.filter((branch) => !branch.current && !branch.worktree && branch.name !== context.status.branch)

/**
 * Why a branch action cannot run, or null when it can. The same checks the host makes before it touches Git, so the phone
 * says why up front; the host still decides. The reason is English copy for the caller to translate.
 */
export function branchActionBlock(action: BranchAction, context: BranchContext): string | null {
  if (!context.canWrite) return 'This device is view-only, so it cannot change branches.'
  const { status, branches } = context
  const exists = (name: string) => branches.some((branch) => branch.name === name)
  const clean = !status.entries.length && !status.operation
  if (action.kind === 'delete') {
    if (action.name === status.branch) return 'Switch to another branch before deleting this one.'
    return deletableBranches(context).some((branch) => branch.name === action.name)
      ? null
      : 'This branch is checked out in another worktree.'
  }
  if (status.operation) return 'Finish the rebase or merge in progress first.'
  if (action.kind === 'merge') {
    if (!status.branch) return 'Switch to a branch before merging into it.'
    if (action.name === status.branch) return 'Choose a different branch to merge into this one.'
    if (!exists(action.name)) return 'Select an existing local branch.'
    return clean ? null : 'Commit or stash your changes first.'
  }
  if (action.kind === 'rename' && !status.branch) return 'Switch to a branch before renaming it.'
  if (action.kind === 'create-from' && !exists(action.from)) return 'Select an existing local branch to start from.'
  if (!validBranchName(action.name)) return 'Use letters, numbers, “/”, “-”, “_” and “.” without spaces.'
  if (exists(action.name)) return 'A branch with this name already exists.'
  if (action.kind === 'create-from' && !clean) return 'Commit or stash your changes first.'
  return null
}

/** Why an entry of the branch sheet is unavailable before a branch or name is picked, or null when it can open. */
export function branchOptionBlock(kind: BranchAction['kind'], context: BranchContext): string | null {
  if (!context.canWrite) return 'This device is view-only, so it cannot change branches.'
  const { status } = context
  if (kind === 'delete') return deletableBranches(context).length ? null : 'There is no other branch to delete.'
  if (kind === 'rename') return status.branch ? null : 'Switch to a branch before renaming it.'
  if (status.operation) return 'Finish the rebase or merge in progress first.'
  if (kind === 'merge' && !status.branch) return 'Switch to a branch before merging into it.'
  if (kind === 'merge' && !context.branches.some((branch) => branch.name !== status.branch))
    return 'There is no other branch to merge.'
  return status.entries.length ? 'Commit or stash your changes first.' : null
}

/**
 * Runs a branch action on the host. A merge that stops on conflicts is not a failure here: it leaves the merge in progress
 * for Source Control, and the conflicted files are returned for the caller to open.
 */
export async function runBranchAction(
  invoke: Invoke,
  target: { computerId: string; taskId: string; repoId: string },
  action: BranchAction,
): Promise<{ conflicts: string[] }> {
  const { computerId, taskId, repoId } = target
  if (action.kind === 'create-from')
    await invoke(computerId, 'git.createBranchFrom', taskId, repoId, action.name, action.from)
  else if (action.kind === 'rename') await invoke(computerId, 'git.renameBranch', taskId, repoId, action.name)
  else if (action.kind === 'delete') await invoke(computerId, 'git.deleteBranch', taskId, repoId, action.name)
  else
    try {
      await invoke(computerId, 'git.mergeBranch', taskId, repoId, action.name)
    } catch (error) {
      const status = await invoke(computerId, 'git.status', taskId, repoId).catch(() => null)
      if (status?.operation !== 'merge') throw error
      return {
        conflicts: status.entries
          .filter((entry) => entry.staged === 'unmerged' || entry.unstaged === 'unmerged')
          .map((entry) => entry.path),
      }
    }
  return { conflicts: [] }
}

/**
 * Where a merge that stopped on conflicts leads: the Changes tab with its Merge changes group open, a notice saying what
 * to do, and the first conflicted file; the rest follow from that file's Next conflicted file. Nothing happens without
 * conflicts.
 */
export function routeMergeConflicts(
  conflicts: readonly string[],
  screen: { showConflicts(): void; notify(message: string): void; openConflict(path: string): void },
  message: string,
): void {
  const first = conflicts[0]
  if (first === undefined) return
  screen.showConflicts()
  screen.notify(message)
  screen.openConflict(first)
}
