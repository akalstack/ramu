import type { DirEntry } from '@ramu/shared/types'

export type Clip = { taskId: string; repoId: string; paths: string[]; cut: boolean }

/** Shared by every repository tree: what was cut or copied, which tree was used last, and what is being dragged. */
type TreeShared = {
  clip: Clip | null
  lastRepo: string | null
  dragging: { repoId: string; cwd: string; paths: string[] } | null
}
const hosts = new Map<string, TreeShared>()
export function sharedForHost(host: string): TreeShared {
  let value = hosts.get(host)
  if (!value) {
    value = { clip: null, lastRepo: null, dragging: null }
    hosts.set(host, value)
  }
  return value
}

export type TreeAction =
  | { type: 'create'; parent: string; kind: 'file' | 'dir' }
  | { type: 'rename'; entry: DirEntry }
  | { type: 'delete'; entries: DirEntry[] }
