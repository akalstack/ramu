import type { DirEntry } from '@ramu/shared/types'

export type Clip = { taskId: string; repoId: string; paths: string[]; cut: boolean }

/** Shared by every repository tree: what was cut or copied, which tree was used last, and what is being dragged. */
export const shared: {
  clip: Clip | null
  lastRepo: string | null
  dragging: { repoId: string; cwd: string; paths: string[] } | null
} = { clip: null, lastRepo: null, dragging: null }

export type TreeAction =
  | { type: 'create'; parent: string; kind: 'file' | 'dir' }
  | { type: 'rename'; entry: DirEntry }
  | { type: 'delete'; entries: DirEntry[] }
