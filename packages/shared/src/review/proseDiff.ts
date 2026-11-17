/**
 * A Markdown document compared block by block, as GitHub's prose rich diff shows one: paragraphs, headings and list
 * items that kept their words read plainly, ones that changed show which words went and came, and code, tables and
 * quotes that changed show before then after.
 */

export type ProseBlockKind = 'heading' | 'item' | 'paragraph' | 'other'

export interface ProseBlock {
  /** The block's Markdown, drawn as written when it is unchanged, added or removed. */
  source: string
  kind: ProseBlockKind
  /** A heading's level, 1 to 6. */
  level?: number
  /** A list item's marker as written: `-`, `*`, `3.` or `- [ ]`. */
  marker?: string
  /** The words a reader sees, inline formatting removed; what a changed prose block compares. */
  text: string
}

export type WordPart = { kind: 'same' | 'del' | 'ins'; text: string }

export type ProseEntry =
  | { kind: 'same' | 'del' | 'ins'; block: ProseBlock }
  | { kind: 'changed'; before: ProseBlock; after: ProseBlock; words: WordPart[] }

export type ProseSection = ProseEntry | { kind: 'fold'; entries: ProseEntry[] }

const LIST_ITEM = /^ {0,3}((?:[-*+]|\d{1,9}[.)])(?: \[[ xX]\])?)(?:\s+|$)/
const FENCE = /^ {0,3}(`{3,}|~{3,})/
const HEADING = /^ {0,3}(#{1,6})(?:\s+|$)/
/** Past this many block or word comparisons a change is shown whole, so a huge document cannot stall the review. */
const MAX_COMPARISONS = 250_000

/** A document cut into blocks; each list item is a block of its own, so one changed item does not mark the whole list. */
export function proseBlocks(source: string): ProseBlock[] {
  const blocks: string[][] = []
  let current: string[] = []
  let fence: string | null = null
  let blank = false
  const close = () => {
    while (current.length && !current.at(-1)!.trim()) current.pop()
    if (current.length) blocks.push(current)
    current = []
  }
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    const marker = FENCE.exec(line)?.[1]
    if (fence) {
      current.push(line)
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null
      continue
    }
    if (!line.trim()) {
      blank = true
      continue
    }
    const indented = /^\s{2,}/.test(line)
    const interrupts = LIST_ITEM.test(line) || HEADING.test(line) || (Boolean(marker) && !indented)
    const inItem = current.length > 0 && LIST_ITEM.test(current[0]!)
    // An item's own indented lines (nested lists, code, more paragraphs) stay with it, even across blank lines.
    const continues = current.length > 0 && ((inItem && indented) || (!blank && !interrupts))
    if (!continues || HEADING.test(current[0] ?? '')) close()
    else if (blank) current.push('')
    blank = false
    if (marker) fence = marker
    current.push(line)
    if (HEADING.test(line) && current.length === 1) close()
  }
  close()
  return blocks.map((lines) => classify(lines.join('\n')))
}

function classify(source: string): ProseBlock {
  const lines = source.split('\n')
  const first = lines[0]!
  const heading = HEADING.exec(first)
  if (heading && lines.length === 1)
    return { source, kind: 'heading', level: heading[1]!.length, text: inlineText(first.slice(heading[0].length)) }
  const item = LIST_ITEM.exec(first)
  // An item holding more than its own text (a nested list, code) compares as a whole, like code or a table.
  if (item && !lines.slice(1).some((line) => LIST_ITEM.test(line.trimStart()) || FENCE.test(line.trimStart())))
    return {
      source,
      kind: 'item',
      marker: item[1]!,
      text: inlineText([first.slice(item[0].length), ...lines.slice(1)].join(' ')),
    }
  const other =
    FENCE.test(first) ||
    /^ {0,3}(>|\||<|(\*\s*){3,}$|(-\s*){3,}$|(_\s*){3,}$)/.test(first) ||
    (lines.length > 1 && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[1]!)) ||
    /^ {4}/.test(first) ||
    Boolean(item)
  return { source, kind: other ? 'other' : 'paragraph', text: other ? source : inlineText(lines.join(' ')) }
}

/** Inline Markdown as read: link and image text kept, emphasis, code ticks and hard-break markers dropped. */
function inlineText(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Longest common subsequence as aligned pairs; null when the inputs are too large to compare. */
function align<T>(a: T[], b: T[], same: (x: T, y: T) => boolean): [number, number][] | null {
  let start = 0
  while (start < a.length && start < b.length && same(a[start]!, b[start]!)) start++
  let endA = a.length,
    endB = b.length
  while (endA > start && endB > start && same(a[endA - 1]!, b[endB - 1]!)) {
    endA--
    endB--
  }
  const pairs: [number, number][] = []
  for (let i = 0; i < start; i++) pairs.push([i, i])
  const rows = endA - start,
    cols = endB - start
  if (rows && cols) {
    if (rows * cols > MAX_COMPARISONS) return null
    const table = Array.from({ length: rows + 1 }, () => new Uint32Array(cols + 1))
    for (let i = rows - 1; i >= 0; i--)
      for (let j = cols - 1; j >= 0; j--)
        table[i]![j] = same(a[start + i]!, b[start + j]!)
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    let i = 0,
      j = 0
    while (i < rows && j < cols) {
      if (same(a[start + i]!, b[start + j]!)) {
        pairs.push([start + i, start + j])
        i++
        j++
      } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++
      else j++
    }
  }
  for (let k = 0; k < a.length - endA; k++) pairs.push([endA + k, endB + k])
  return pairs
}

/** Which words a changed prose block lost and gained, whitespace kept with the words around it. */
export function wordDiff(before: string, after: string): WordPart[] {
  const a = before.match(/\s+|[^\s]+/g) ?? [],
    b = after.match(/\s+|[^\s]+/g) ?? []
  const pairs = align(a, b, (x, y) => x === y) ?? []
  const parts: WordPart[] = []
  const push = (kind: WordPart['kind'], text: string) => {
    const last = parts.at(-1)
    if (last?.kind === kind) last.text += text
    else parts.push({ kind, text })
  }
  let i = 0,
    j = 0
  for (const [x, y] of [...pairs, [a.length, b.length] as [number, number]]) {
    if (i < x) push('del', a.slice(i, x).join(''))
    if (j < y) push('ins', b.slice(j, y).join(''))
    if (x < a.length) push('same', a[x]!)
    i = x + 1
    j = y + 1
  }
  return parts
}

const prose = (block: ProseBlock) => block.kind !== 'other'
/** Two blocks are one changed block when they are the same kind of prose and still share some of their words. */
const pairable = (before: ProseBlock, after: ProseBlock) =>
  prose(before) &&
  before.kind === after.kind &&
  before.level === after.level &&
  wordDiff(before.text, after.text).some((part) => part.kind === 'same' && part.text.trim())

export function proseDiff(before: string, after: string): ProseEntry[] {
  const a = proseBlocks(before),
    b = proseBlocks(after)
  const pairs = align(a, b, (x, y) => x.source.trim() === y.source.trim()) ?? []
  const entries: ProseEntry[] = []
  // Between unchanged blocks, each old block sits next to the new one in its place: one changed block when they are
  // prose still sharing words, otherwise the old then the new.
  const gap = (removed: ProseBlock[], added: ProseBlock[]) => {
    for (let k = 0; k < Math.max(removed.length, added.length); k++) {
      const old = removed[k],
        next = added[k]
      if (old && next && pairable(old, next))
        entries.push({ kind: 'changed', before: old, after: next, words: wordDiff(old.text, next.text) })
      else {
        if (old) entries.push({ kind: 'del', block: old })
        if (next) entries.push({ kind: 'ins', block: next })
      }
    }
  }
  let i = 0,
    j = 0
  for (const [x, y] of pairs) {
    gap(a.slice(i, x), b.slice(j, y))
    entries.push({ kind: 'same', block: b[y]! })
    i = x + 1
    j = y + 1
  }
  gap(a.slice(i), b.slice(j))
  return entries
}

/** Long runs of unchanged blocks fold away, keeping `context` blocks beside each change so it reads in place. */
export function proseSections(entries: ProseEntry[], context = 1, smallest = 3): ProseSection[] {
  const sections: ProseSection[] = []
  let index = 0
  while (index < entries.length) {
    if (entries[index]!.kind !== 'same') {
      sections.push(entries[index]!)
      index++
      continue
    }
    let end = index
    while (end < entries.length && entries[end]!.kind === 'same') end++
    const keepStart = index === 0 ? 0 : context,
      keepEnd = end === entries.length ? 0 : context
    const run = entries.slice(index, end)
    if (run.length - keepStart - keepEnd >= smallest) {
      sections.push(...run.slice(0, keepStart))
      sections.push({ kind: 'fold', entries: run.slice(keepStart, run.length - keepEnd) })
      sections.push(...run.slice(run.length - keepEnd))
    } else sections.push(...run)
    index = end
  }
  return sections
}
