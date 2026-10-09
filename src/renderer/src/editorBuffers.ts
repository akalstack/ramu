import type { EditorSelection } from '../../shared/composerContext'

// Lazy readers preserve unsaved buffers without copying every keystroke into workspace state.
const buffers = new Map<string, () => string | undefined>()
const key = (owner: string, repoId: string, path: string) => `${owner}\0${repoId}\0${path}`
export function registerBuffer(owner: string, repoId: string, path: string, read: () => string | undefined): () => void {
  const id = key(owner, repoId, path); buffers.set(id, read)
  return () => { if (buffers.get(id) === read) buffers.delete(id) }
}
export function readBuffer(owner: string, repoId: string, path: string): string | undefined { return buffers.get(key(owner, repoId, path))?.() }

const selections = new Map<string, Set<() => EditorSelection | undefined>>()
export function registerSelection(viewId: string, read: () => EditorSelection | undefined): () => void {
  const readers = selections.get(viewId) ?? new Set()
  readers.add(read)
  selections.set(viewId, readers)
  return () => { readers.delete(read); if (!readers.size) selections.delete(viewId) }
}
export function readSelection(viewId: string): EditorSelection | undefined {
  for (const read of selections.get(viewId) ?? []) { const selection = read(); if (selection) return selection }
  return undefined
}
