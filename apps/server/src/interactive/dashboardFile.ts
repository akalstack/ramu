// A dashboard table read from a CSV or JSON file in its project: only the columns the dashboard names, matched by
// header or key, so a file that gains columns keeps drawing the same table.
import { DASHBOARD_ROWS_MAX } from '@ramu/shared/artifactSource'

type Cell = string | number | null

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i

function cell(value: unknown): Cell {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return String(value)
  const text = (typeof value === 'string' ? value : JSON.stringify(value)).trim()
  if (!text) return null
  return NUMBER.test(text) ? Number(text) : text.slice(0, 200)
}

/** CSV records with quoted fields, doubled quotes and line breaks inside quotes. */
function csvRecords(text: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') field += text[i++]
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && !field) quoted = true
    else if (c === ',') {
      record.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      record.push(field)
      if (record.some((value) => value !== '')) records.push(record)
      record = []
      field = ''
      if (records.length > DASHBOARD_ROWS_MAX) break
    } else field += c
  }
  record.push(field)
  if (record.some((value) => value !== '')) records.push(record)
  return records
}

const key = (name: string) => name.trim().toLowerCase()

/** The rows of `columns` from a file's text; a column the file does not have reads as empty. */
export function tableFromFile(path: string, text: string, columns: string[]): Cell[][] {
  let objects: Record<string, unknown>[]
  if (/\.json$/i.test(path)) {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) throw new Error(`${path} is not a JSON array of objects.`)
    objects = parsed.filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item),
    )
  } else {
    const [header = [], ...rows] = csvRecords(text.replace(/^\uFEFF/, ''))
    objects = rows.map((row) => Object.fromEntries(header.map((name, index) => [name, row[index]])))
  }
  return objects.slice(0, DASHBOARD_ROWS_MAX).map((object) => {
    const byKey = new Map(Object.entries(object).map(([name, value]) => [key(name), value]))
    return columns.map((column) => cell(byKey.get(key(column))))
  })
}
