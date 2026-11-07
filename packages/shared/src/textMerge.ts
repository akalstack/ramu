// A line-based three-way merge, for two edits of the same text made from one earlier version: on the desktop and the
// phone at once, or by the person while an agent saved a version. Changes to different lines are both kept; changes
// to the same lines (or two insertions at one place) that differ are a conflict, and the caller asks the person.
// Pure, so the host and the tests merge the same way.
import type { Slide } from './artifactSource'

interface Change {
  /** The base lines replaced, as a half-open range. */
  start: number
  end: number
  lines: string[]
}

/** Comparing more than this many line pairs gives up, and the edit is treated as a conflict. */
const MAX_CELLS = 4_000_000

/** The changes that turn `base` into `other`, in order, from the longest common subsequence of their lines. */
function changes(base: string[], other: string[]): Change[] | null {
  let prefix = 0
  while (prefix < base.length && prefix < other.length && base[prefix] === other[prefix]) prefix++
  let suffix = 0
  while (
    suffix < base.length - prefix &&
    suffix < other.length - prefix &&
    base[base.length - 1 - suffix] === other[other.length - 1 - suffix]
  )
    suffix++
  const a = base.slice(prefix, base.length - suffix)
  const b = other.slice(prefix, other.length - suffix)
  if (!a.length && !b.length) return []
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) return null
  // lengths[i][j]: the common subsequence of a[i..] and b[j..], kept as one row-major array.
  const width = b.length + 1
  const lengths = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lengths[i * width + j] =
        a[i] === b[j]
          ? lengths[(i + 1) * width + j + 1]! + 1
          : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!)
  const found: Change[] = []
  let i = 0
  let j = 0
  let open: Change | null = null
  const close = () => {
    if (open) found.push(open)
    open = null
  }
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      close()
      i++
      j++
    } else if (j < b.length && (i === a.length || lengths[i * width + j + 1]! >= lengths[(i + 1) * width + j]!)) {
      open ??= { start: prefix + i, end: prefix + i, lines: [] }
      open.lines.push(b[j]!)
      j++
    } else {
      open ??= { start: prefix + i, end: prefix + i, lines: [] }
      open.end = prefix + i + 1
      i++
    }
  }
  close()
  return found
}

const same = (x: Change, y: Change) =>
  x.start === y.start &&
  x.end === y.end &&
  x.lines.length === y.lines.length &&
  x.lines.every((line, k) => line === y.lines[k])

/** Whether two changes touch the same base lines, or insert at the same place. */
const clash = (x: Change, y: Change) =>
  (x.start < y.end && y.start < x.end) || (x.start === y.start && (x.start === x.end || y.start === y.end))

/**
 * `ours` and `theirs` merged over `base`, or null when they change the same lines differently. Identical changes
 * on both sides count once.
 */
export function mergeText(base: string, ours: string, theirs: string): string | null {
  if (ours === theirs) return ours
  if (ours === base) return theirs
  if (theirs === base) return ours
  const lines = base.split('\n')
  const mine = changes(lines, ours.split('\n'))
  const other = changes(lines, theirs.split('\n'))
  if (!mine || !other) return null
  const all: Change[] = [...mine]
  for (const change of other) {
    if (mine.some((entry) => same(entry, change))) continue
    if (mine.some((entry) => clash(entry, change))) return null
    all.push(change)
  }
  // Applied from the end, so earlier ranges keep their positions.
  for (const change of all.sort((x, y) => y.start - x.start || y.end - x.end))
    lines.splice(change.start, change.end - change.start, ...change.lines)
  return lines.join('\n')
}

const SLIDE_TEXT = ['title', 'body', 'by', 'notes'] as const

/**
 * A deck's slide text from two edits of one earlier version, merged field by field the way a doc's lines are: the
 * current deck's slides with the person's text changes on top. Null when the decks' slides were added, removed or
 * moved since, or when both changed the same lines of one field differently.
 */
export function mergeSlideText(base: Slide[], mine: Slide[], current: Slide[]): Slide[] | null {
  if (mine.length !== base.length || current.length !== base.length) return null
  const merged: Slide[] = []
  for (const [index, slide] of current.entries()) {
    const was = base[index]!
    const edited = mine[index]!
    // A slide moved or relaid out since is not the same slide any more.
    if (slide.layout !== was.layout || edited.layout !== was.layout) return null
    const next: Slide = { ...slide }
    for (const key of SLIDE_TEXT) {
      const text = mergeText(was[key] ?? '', edited[key] ?? '', slide[key] ?? '')
      if (text === null) return null
      if (text.trim()) next[key] = text
      else delete next[key]
    }
    if (was.columns || edited.columns || slide.columns) {
      const columns = [0, 1].map((at) =>
        mergeText(was.columns?.[at] ?? '', edited.columns?.[at] ?? '', slide.columns?.[at] ?? ''),
      )
      if (columns.some((column) => column === null)) return null
      next.columns = columns as NonNullable<Slide['columns']>
    }
    merged.push(next)
  }
  return merged
}
