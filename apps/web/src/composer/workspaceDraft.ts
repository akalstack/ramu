import { parseWorkspaceChoice, type WorkspaceChoice } from '@ramu/shared/workspaceDefaults'
import type { Store } from '../hostStorage'

const keyOf = (projectId: string) => `ramu.new-thread-workspace:${projectId}`
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
export interface WorkspaceDraft {
  choice: WorkspaceChoice
  problem?: 'storage' | 'invalid'
}

/** Device/host-scoped metadata; never resolves a default or creates a workspace while restoring. */
export function loadWorkspaceDraft(projectId: string, store: Store | null, now = Date.now()): WorkspaceDraft {
  try {
    if (!store) return { choice: { mode: null }, problem: 'storage' }
    const text = store.getItem(keyOf(projectId))
    if (text === null) return { choice: { mode: null } }
    if (text.length > 64 * 1024) return { choice: { mode: null }, problem: 'invalid' }
    const value = JSON.parse(text)
    const choice = parseWorkspaceChoice(value)
    if (!choice || typeof value.at !== 'number' || !Number.isFinite(value.at))
      return { choice: { mode: null }, problem: 'invalid' }
    if (now - value.at > MAX_AGE_MS) return { choice: { mode: null } }
    return { choice }
  } catch {
    return { choice: { mode: null }, problem: 'storage' }
  }
}

export function saveWorkspaceDraft(
  projectId: string,
  choice: WorkspaceChoice,
  store: Store | null,
  now = Date.now(),
): boolean {
  try {
    const parsed = parseWorkspaceChoice({ version: 1, ...choice })
    if (!store || !parsed) return false
    store.setItem(keyOf(projectId), JSON.stringify({ version: 1, ...parsed, at: now }))
    return true
  } catch {
    return false
  }
}

/** A failed clear is reported; it never removes the text draft or another project's metadata. */
export function clearWorkspaceDraft(projectId: string, store: Store | null, expected?: WorkspaceChoice): boolean {
  try {
    if (!store) return false
    if (expected) {
      const current = loadWorkspaceDraft(projectId, store)
      if (
        current.problem ||
        current.choice.mode !== expected.mode ||
        current.choice.workspaceId !== expected.workspaceId ||
        current.choice.name !== expected.name ||
        JSON.stringify(current.choice.branch) !== JSON.stringify(expected.branch)
      )
        return false
    }
    store.removeItem(keyOf(projectId))
    return true
  } catch {
    return false
  }
}
