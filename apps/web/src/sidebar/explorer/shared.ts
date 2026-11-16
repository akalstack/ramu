import type { DirEntry } from '@ramu/shared/types'

/** Items picked in an explorer tree. `cwd` names the checkout, so two threads of one repository stay apart. */
export type TreeItems = { hostId: string; taskId: string; repoId: string; cwd: string; paths: string[] }
export type Clip = TreeItems & {
  cut: boolean
  /**
   * The files the system clipboard held right after this copy. When they differ at paste time, the person copied
   * something in Finder (or another app) since, and that newer copy wins.
   */
  systemFiles?: string
}
/** What a paste or drop places: items from a tree, or files of this computer (Finder, the desktop). */
export type PlaceSource = ({ kind: 'tree' } & TreeItems & { cut: boolean }) | { kind: 'system'; paths: string[] }

/**
 * Shared by every tree in the window, across hosts: what was cut or copied and what is being dragged, so items move
 * between projects and between computers the way they do between folders.
 */
export const explorerClipboard: { clip: Clip | null; dragging: TreeItems | null } = { clip: null, dragging: null }

/** Which tree of a host was used last, so the panel's New file and New folder buttons go there. */
type TreeShared = { lastRepo: string | null }
const hosts = new Map<string, TreeShared>()
export function sharedForHost(host: string): TreeShared {
  let value = hosts.get(host)
  if (!value) {
    value = { lastRepo: null }
    hosts.set(host, value)
  }
  return value
}

export type TreeAction =
  | { type: 'create'; parent: string; kind: 'file' | 'dir' }
  | { type: 'rename'; entry: DirEntry }
  | { type: 'delete'; entries: DirEntry[] }
