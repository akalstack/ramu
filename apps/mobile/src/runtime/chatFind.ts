import type { TranscriptItem } from './types'

type Row = TranscriptItem | { kind: string; id: string }

/** The words a row shows, folded steps included, so a match inside "Worked for" or a tool group leads to that row. */
function rowText(row: Row): string {
  const item = row as TranscriptItem
  switch (item.kind) {
    case 'user':
    case 'text':
    case 'thinking':
      return item.text
    case 'report':
      return `${item.name} ${item.body}`
    case 'error':
      return item.message
    case 'tool':
      return `${item.verb} ${item.subject}`
    case 'tools':
      return item.entries.map((entry) => rowText(entry as TranscriptItem)).join('\n')
    case 'summary':
      return item.items.map(rowText).join('\n')
    case 'plan':
      return item.entries.map((entry) => entry.content).join('\n')
    case 'note':
      return `${item.title} ${item.detail ?? ''}`
    case 'goal':
      return item.objective
    case 'permission':
      return `${item.title} ${item.command}`
    default:
      return ''
  }
}

/** Every occurrence of the query in the rows, in order, each naming its row; case is ignored. */
export function findInRows(rows: readonly Row[], query: string): { id: string; index: number }[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const matches: { id: string; index: number }[] = []
  rows.forEach((row, index) => {
    const text = rowText(row).toLowerCase()
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length))
      matches.push({ id: row.id, index })
  })
  return matches
}
