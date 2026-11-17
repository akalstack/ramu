import { lineDiff, textDiffRows, type DiffRow } from './lineDiff'

export type NotebookOutput =
  { kind: 'text'; text: string; error?: boolean } | { kind: 'markdown'; text: string } | { kind: 'image'; uri: string }

export interface NotebookCell {
  type: 'code' | 'markdown' | 'raw'
  source: string
  outputs: NotebookOutput[]
}

export type NotebookCellChange =
  | { kind: 'same' | 'added' | 'removed'; cell: NotebookCell }
  | { kind: 'modified'; before: NotebookCell; after: NotebookCell; source: DiffRow[]; outputsChanged: boolean }

const joined = (value: unknown): string =>
  typeof value === 'string' ? value : Array.isArray(value) ? value.filter((v) => typeof v === 'string').join('') : ''

function output(raw: unknown): NotebookOutput[] {
  if (!raw || typeof raw !== 'object') return []
  const item = raw as Record<string, unknown>
  if (item.output_type === 'stream') return [{ kind: 'text', text: joined(item.text) }]
  if (item.output_type === 'error')
    return [{ kind: 'text', text: `${joined(item.ename)}: ${joined(item.evalue)}`, error: true }]
  const data = (item.data ?? {}) as Record<string, unknown>
  // One representation per output, the richest a review can draw, as Jupyter picks one.
  for (const type of ['image/png', 'image/jpeg'] as const) {
    const base64 = joined(data[type]).replace(/\s/g, '')
    if (base64) return [{ kind: 'image', uri: `data:${type};base64,${base64}` }]
  }
  if (data['text/markdown']) return [{ kind: 'markdown', text: joined(data['text/markdown']) }]
  if (data['text/plain']) return [{ kind: 'text', text: joined(data['text/plain']) }]
  return []
}

/** A notebook's cells, or null when the text is not a Jupyter notebook. An empty side (added or deleted) has none. */
export function parseNotebook(text: string): NotebookCell[] | null {
  if (!text.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const cells = (parsed as { cells?: unknown })?.cells
  if (!Array.isArray(cells)) return null
  return cells.map((raw) => {
    const cell = (raw ?? {}) as Record<string, unknown>
    const type = cell.cell_type === 'markdown' || cell.cell_type === 'raw' ? cell.cell_type : 'code'
    return {
      type,
      source: joined(cell.source),
      outputs: Array.isArray(cell.outputs) ? cell.outputs.flatMap(output) : [],
    }
  })
}

const sameOutputs = (a: NotebookCell, b: NotebookCell) => JSON.stringify(a.outputs) === JSON.stringify(b.outputs)

/**
 * Cell by cell, as GitHub's notebook diff reads: cells matched by their source, a removed cell followed by an added
 * one read as that cell modified, and a cell whose source stayed but whose outputs changed marked as modified too.
 * Null when either side is not a notebook.
 */
export function diffNotebook(before: string, after: string): NotebookCellChange[] | null {
  const a = parseNotebook(before),
    b = parseNotebook(after)
  if (!a || !b) return null
  const rows = lineDiff(a, b, (x, y) => x.type === y.type && x.source === y.source)
  const changes: NotebookCellChange[] = []
  for (let index = 0; index < rows.length;) {
    const row = rows[index]!
    if (row.type === 'ctx') {
      const [x, y] = [row.before!, row.after!]
      changes.push(
        sameOutputs(x, y)
          ? { kind: 'same', cell: y }
          : { kind: 'modified', before: x, after: y, source: textDiffRows(x.source, y.source), outputsChanged: true },
      )
      index++
      continue
    }
    const removed: NotebookCell[] = [],
      added: NotebookCell[] = []
    while (index < rows.length && rows[index]!.type !== 'ctx') {
      const next = rows[index++]!
      if (next.type === 'del') removed.push(next.before!)
      else added.push(next.after!)
    }
    const paired = Math.min(removed.length, added.length)
    for (let i = 0; i < paired; i++)
      changes.push({
        kind: 'modified',
        before: removed[i]!,
        after: added[i]!,
        source: textDiffRows(removed[i]!.source, added[i]!.source),
        outputsChanged: !sameOutputs(removed[i]!, added[i]!),
      })
    for (const cell of removed.slice(paired)) changes.push({ kind: 'removed', cell })
    for (const cell of added.slice(paired)) changes.push({ kind: 'added', cell })
  }
  return changes
}
