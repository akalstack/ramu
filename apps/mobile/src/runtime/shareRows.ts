// Rebuilding a transcript makes new objects for every row, which defeats memoised rows: each rebuild re-rendered every
// visible row, markdown and all. Reusing the previous object for a row that did not change keeps that work to the rows
// that did. No React Native imports, so Node tests cover it.

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let index = 0; index < a.length; index++) if (!same(a[index], b[index])) return false
    return true
  }
  if (Array.isArray(b)) return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  for (const key of keys) if (!(key in right) || !same(left[key], right[key])) return false
  return true
}

/**
 * `next` with every row that equals the previous row of the same id replaced by that previous object; the previous
 * array itself when nothing changed at all.
 */
export function shareRows<T extends { id: string }>(previous: readonly T[] | undefined, next: T[]): T[] {
  if (!previous?.length) return next
  const byId = new Map(previous.map((row) => [row.id, row]))
  let changed = previous.length !== next.length
  const shared = next.map((row, index) => {
    const old = byId.get(row.id)
    const kept = old && (old === row || same(old, row)) ? old : row
    if (kept !== previous[index]) changed = true
    return kept
  })
  return changed ? shared : (previous as T[])
}
