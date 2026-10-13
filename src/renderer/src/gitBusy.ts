import { useSyncExternalStore } from 'react'

/** Tracks in-flight git work per repository so every surface (Source Control, status bar, commands) shows the same busy state. */
const counts = new Map<string, number>()
const listeners = new Set<() => void>()
const key = (taskId: string, repoId: string) => `${taskId}:${repoId}`
const emit = () => listeners.forEach((listener) => listener())

const tails = new Map<string, Promise<unknown>>()

/** Runs git work one at a time per repository, in the order it was requested. Do not nest calls for the same repo. */
export async function withGitBusy<T>(taskId: string, repoId: string, work: () => Promise<T>): Promise<T> {
  const id = key(taskId, repoId)
  // Counted from the moment it is requested, so controls stay disabled while it waits its turn.
  counts.set(id, (counts.get(id) ?? 0) + 1); emit()
  const previous = tails.get(id) ?? Promise.resolve()
  const turn = previous.catch(() => {}).then(work)
  tails.set(id, turn)
  try { return await turn }
  finally {
    if (tails.get(id) === turn) tails.delete(id)
    const next = (counts.get(id) ?? 1) - 1
    if (next > 0) counts.set(id, next); else counts.delete(id)
    emit()
  }
}

export const isGitBusy = (taskId: string, repoId: string) => counts.has(key(taskId, repoId))

/**
 * Timer-driven work such as auto-fetch. It skips a tick when anything is running or waiting for the repo, and takes a
 * turn in the queue otherwise, so a user action that arrives meanwhile waits behind it. It never marks the repo busy.
 */
export async function withGitBackground(taskId: string, repoId: string, work: () => Promise<void>): Promise<boolean> {
  const id = key(taskId, repoId)
  if (counts.has(id) || tails.has(id)) return false
  const turn = Promise.resolve().then(work)
  tails.set(id, turn)
  try { await turn } finally { if (tails.get(id) === turn) tails.delete(id) }
  return true
}

export function useGitBusy(taskId: string | undefined, repoId: string | undefined): boolean {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => !!taskId && !!repoId && counts.has(key(taskId, repoId)),
  )
}
