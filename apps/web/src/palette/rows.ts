import type { PaletteGroup } from './engine'
import type { PaletteResult } from './sources'

export type PaletteRow =
  | { kind: 'header'; key: string; label: string; stale: boolean }
  | { kind: 'result'; key: string; group: string; result: PaletteResult; stale: boolean }
  | { kind: 'more'; key: string; group: string; hidden: number }
  | { kind: 'loading'; key: string }
  | { kind: 'error'; key: string; message: string }
  | { kind: 'limited'; key: string; shown: number }

export const rowKey = (group: string, key: string) => `${group}:${key}`

/**
 * Flattens groups into the rows the list draws. Each group shows its first `initialShow` results
 * unless expanded; groups never mix. Groups with nothing to show and nothing pending are left out.
 */
export function buildRows(groups: readonly PaletteGroup[], expanded: ReadonlySet<string>): PaletteRow[] {
  const rows: PaletteRow[] = []
  for (const group of groups) {
    if (group.status === 'done' && !group.results.length) continue
    rows.push({ kind: 'header', key: `h:${group.id}`, label: group.label, stale: group.stale })
    const open = expanded.has(group.id)
    const shown = open ? group.results : group.results.slice(0, group.initialShow)
    for (const result of shown)
      rows.push({
        kind: 'result',
        key: rowKey(group.id, result.key),
        group: group.id,
        result,
        stale: group.stale,
      })
    if (shown.length < group.results.length)
      rows.push({
        kind: 'more',
        key: `m:${group.id}`,
        group: group.id,
        hidden: group.results.length - shown.length,
      })
    // Stale results already signal a pending refresh by being dimmed.
    if (group.status === 'loading' && (!group.stale || !group.results.length))
      rows.push({ kind: 'loading', key: `l:${group.id}` })
    if (group.status === 'error') rows.push({ kind: 'error', key: `e:${group.id}`, message: group.error ?? '' })
    if (group.limited && group.status !== 'error')
      rows.push({ kind: 'limited', key: `x:${group.id}`, shown: group.results.length })
  }
  return rows
}

export const isSelectable = (row: PaletteRow) => row.kind === 'result' || row.kind === 'more'

/** The key to select: the user's choice if it is still listed, else the first selectable row. */
export function resolveSelection(rows: readonly PaletteRow[], chosen: string | null): string | null {
  if (chosen && rows.some((row) => row.key === chosen && isSelectable(row))) return chosen
  return rows.find(isSelectable)?.key ?? null
}

/** Moves the selection by `delta` selectable rows, wrapping at both ends. */
export function moveSelection(rows: readonly PaletteRow[], current: string | null, delta: number): string | null {
  const keys = rows.filter(isSelectable).map((row) => row.key)
  if (!keys.length) return null
  const at = current ? keys.indexOf(current) : -1
  if (at < 0) return keys[delta < 0 ? keys.length - 1 : 0]!
  return keys[(at + delta + keys.length) % keys.length]!
}

/** Row to select after expanding a group: its first newly revealed result. */
export function firstRevealed(group: PaletteGroup): string | null {
  const next = group.results[group.initialShow]
  return next ? rowKey(group.id, next.key) : null
}
