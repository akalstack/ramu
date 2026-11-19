export type DiffRow = { type: 'add' | 'del' | 'ctx'; text: string }

/**
 * Two texts as removed, added and shared lines, in order. Shared head and tail lines are matched first; the middle is
 * compared exactly when small, otherwise shown as replaced, so a huge rewrite cannot stall the view.
 */
export function lineDiff<T>(
  before: readonly T[],
  after: readonly T[],
  same: (a: T, b: T) => boolean = (a, b) => a === b,
): { type: 'add' | 'del' | 'ctx'; before?: T; after?: T }[] {
  let start = 0
  while (start < before.length && start < after.length && same(before[start]!, after[start]!)) start++
  let endA = before.length,
    endB = after.length
  while (endA > start && endB > start && same(before[endA - 1]!, after[endB - 1]!)) {
    endA--
    endB--
  }
  const head = before
    .slice(0, start)
    .map((item, index) => ({ type: 'ctx' as const, before: item, after: after[index] }))
  const tail = before
    .slice(endA)
    .map((item, index) => ({ type: 'ctx' as const, before: item, after: after[endB + index] }))
  const x = before.slice(start, endA),
    y = after.slice(start, endB)
  const middle: { type: 'add' | 'del' | 'ctx'; before?: T; after?: T }[] = []
  if (x.length * y.length > 250_000 || !x.length || !y.length) {
    middle.push(...x.map((item) => ({ type: 'del' as const, before: item })))
    middle.push(...y.map((item) => ({ type: 'add' as const, after: item })))
  } else {
    // Longest common subsequence table, read back from the start so removals come before additions.
    const table = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1))
    for (let i = x.length - 1; i >= 0; i--)
      for (let j = y.length - 1; j >= 0; j--)
        table[i]![j] = same(x[i]!, y[j]!) ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    let i = 0,
      j = 0
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && same(x[i]!, y[j]!))
        middle.push({ type: 'ctx', before: x[i++], after: y[j++] })
      else if (j >= y.length || (i < x.length && table[i + 1]![j]! >= table[i]![j + 1]!))
        middle.push({ type: 'del', before: x[i++] })
      else middle.push({ type: 'add', after: y[j++] })
    }
  }
  return [...head, ...middle, ...tail]
}

/** Text lines as diff rows, for showing a changed block's source. */
export function textDiffRows(before: string, after: string): DiffRow[] {
  const split = (text: string) => (text ? text.replace(/\n$/, '').split('\n') : [])
  return lineDiff(split(before), split(after)).map((row) => ({
    type: row.type,
    text: (row.type === 'add' ? row.after : row.before)!,
  }))
}
