import type { FileContext } from '../types'

/** Identity within one composer checkout. A selected excerpt or staged diff must survive a full-file mention. */
export function fileContextKey(file: Pick<FileContext, 'repoId' | 'path' | 'diff' | 'selection'>): string {
  const selection = file.selection
  return JSON.stringify([
    file.repoId,
    file.path,
    file.diff?.staged ?? null,
    file.diff?.oid ?? null,
    file.diff?.stash ?? false,
    selection
      ? [selection.startLine, selection.startColumn, selection.endLine, selection.endColumn, selection.side ?? null]
      : null,
  ])
}
