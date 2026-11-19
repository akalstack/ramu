/** Rows past this on either side are left out of a table's rich diff, so a huge export cannot stall the review. */
export const MAX_TABLE_ROWS = 2000

/**
 * Delimited text as rows of cells, per RFC 4180: quoted cells may hold the delimiter, line breaks and doubled quotes;
 * CRLF and LF both end a row. A quote that never closes is an error, so the review falls back to the text diff.
 */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let at = 0
  while (at < text.length) {
    const char = text[at]!
    if (quoted) {
      if (char === '"') {
        if (text[at + 1] === '"') {
          cell += '"'
          at += 2
          continue
        }
        quoted = false
      } else cell += char
      at++
      continue
    }
    if (char === '"' && cell === '') quoted = true
    else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      if (char === '\r' && text[at + 1] === '\n') at++
    } else cell += char
    at++
  }
  if (quoted) throw new Error('Unterminated quoted cell')
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

export interface TableColumn {
  name: string
  status: 'same' | 'added' | 'removed'
}
/** One cell per column: `before` where the old table had the column, `after` where the new one does. */
export interface TableDiffRow {
  kind: 'same' | 'added' | 'removed' | 'changed'
  cells: { before?: string; after?: string }[]
}
export interface TableDiff {
  columns: TableColumn[]
  rows: TableDiffRow[]
  /** Either side had more than MAX_TABLE_ROWS rows; the rest are not compared. */
  truncated: boolean
}

/** Columns keyed by name and occurrence, so a repeated header name still lines up with its own column. */
function columnKeys(header: string[]): string[] {
  const seen = new Map<string, number>()
  return header.map((name) => {
    const count = seen.get(name) ?? 0
    seen.set(name, count + 1)
    return `${name}\u0000${count}`
  })
}

/** Old and new columns in one order: the new table's, with each removed column kept where it used to sit. */
function mergeColumns(oldKeys: string[], newKeys: string[]): { key: string; status: TableColumn['status'] }[] {
  const inNew = new Set(newKeys)
  const inOld = new Set(oldKeys)
  const merged: { key: string; status: TableColumn['status'] }[] = newKeys.map((key) => ({
    key,
    status: inOld.has(key) ? 'same' : 'added',
  }))
  oldKeys.forEach((key, index) => {
    if (inNew.has(key)) return
    const previous = oldKeys.slice(0, index).findLast((other) => merged.some((m) => m.key === other))
    const at = previous === undefined ? 0 : merged.findIndex((m) => m.key === previous) + 1
    merged.splice(at, 0, { key, status: 'removed' })
  })
  return merged
}

/** Matching rows by longest common subsequence, after trimming the shared start and end; huge middles are not paired. */
function matchRows(a: string[], b: string[]): [number, number][] {
  const pairs: [number, number][] = []
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) pairs.push([start, start++])
  let endA = a.length,
    endB = b.length
  const tail: [number, number][] = []
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) tail.unshift([--endA, --endB])
  const n = endA - start,
    m = endB - start
  if (n && m && n * m <= 4_000_000) {
    const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        table[i]![j] =
          a[start + i] === b[start + j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    let i = 0,
      j = 0
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) pairs.push([start + i++, start + j++])
      else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++
      else j++
    }
  }
  return [...pairs, ...tail]
}

/**
 * Two versions of a CSV or TSV as one table, as GitHub's CSV diff shows them: the first row is the header, rows are
 * matched on the columns both versions share, and within a run of edits each removed row pairs with an added one as a
 * changed row whose cells say what they were and became.
 */
export function tableDiff(oldText: string, newText: string, delimiter = ','): TableDiff {
  const oldRows = oldText ? parseDelimited(oldText, delimiter) : []
  const newRows = newText ? parseDelimited(newText, delimiter) : []
  const oldHeader = oldRows[0] ?? [],
    newHeader = newRows[0] ?? []
  const truncated = oldRows.length - 1 > MAX_TABLE_ROWS || newRows.length - 1 > MAX_TABLE_ROWS
  const oldBody = oldRows.slice(1, MAX_TABLE_ROWS + 1),
    newBody = newRows.slice(1, MAX_TABLE_ROWS + 1)
  const oldKeys = columnKeys(oldHeader),
    newKeys = columnKeys(newHeader)
  const merged = mergeColumns(oldKeys, newKeys)
  const oldAt = new Map(oldKeys.map((key, index) => [key, index]))
  const newAt = new Map(newKeys.map((key, index) => [key, index]))
  const shared = merged.filter((column) => column.status === 'same')
  // Rows are compared on shared columns only, so adding a column does not make every row look changed.
  const key = (row: string[], at: Map<string, number>) =>
    shared.map((column) => row[at.get(column.key)!] ?? '').join('\u0000')
  const pairs = matchRows(
    oldBody.map((row) => key(row, oldAt)),
    newBody.map((row) => key(row, newAt)),
  )
  const cells = (before: string[] | undefined, after: string[] | undefined) =>
    merged.map((column) => ({
      ...(before && oldAt.has(column.key) ? { before: before[oldAt.get(column.key)!] ?? '' } : {}),
      ...(after && newAt.has(column.key) ? { after: after[newAt.get(column.key)!] ?? '' } : {}),
    }))
  const rows: TableDiffRow[] = []
  let i = 0,
    j = 0
  const flush = (untilOld: number, untilNew: number) => {
    const removed = oldBody.slice(i, untilOld),
      added = newBody.slice(j, untilNew)
    const paired = Math.min(removed.length, added.length)
    for (let k = 0; k < paired; k++) rows.push({ kind: 'changed', cells: cells(removed[k], added[k]) })
    for (const row of removed.slice(paired)) rows.push({ kind: 'removed', cells: cells(row, undefined) })
    for (const row of added.slice(paired)) rows.push({ kind: 'added', cells: cells(undefined, row) })
  }
  for (const [oldIndex, newIndex] of pairs) {
    flush(oldIndex, newIndex)
    rows.push({ kind: 'same', cells: cells(oldBody[oldIndex], newBody[newIndex]) })
    i = oldIndex + 1
    j = newIndex + 1
  }
  flush(oldBody.length, newBody.length)
  return {
    columns: merged.map((column) => ({
      name: column.key.slice(0, column.key.indexOf('\u0000')),
      status: column.status,
    })),
    rows,
    truncated,
  }
}

export type TableSegment = { kind: 'rows'; rows: TableDiffRow[] } | { kind: 'fold'; rows: TableDiffRow[] }

/** Long runs of unchanged rows fold away, keeping `context` rows beside each change. */
export function foldTableRows(rows: TableDiffRow[], context = 2): TableSegment[] {
  const segments: TableSegment[] = []
  let shown: TableDiffRow[] = []
  let at = 0
  while (at < rows.length) {
    if (rows[at]!.kind !== 'same') {
      shown.push(rows[at++]!)
      continue
    }
    let end = at
    while (end < rows.length && rows[end]!.kind === 'same') end++
    const lead = at === 0 ? 0 : context
    const trail = end === rows.length ? 0 : context
    if (end - at > lead + trail + 1) {
      shown.push(...rows.slice(at, at + lead))
      if (shown.length) segments.push({ kind: 'rows', rows: shown })
      segments.push({ kind: 'fold', rows: rows.slice(at + lead, end - trail) })
      shown = rows.slice(end - trail, end)
    } else shown.push(...rows.slice(at, end))
    at = end
  }
  if (shown.length) segments.push({ kind: 'rows', rows: shown })
  return segments
}
