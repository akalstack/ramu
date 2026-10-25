import type { AgentContent, AgentToolDetails } from '../types'
import { toolKind } from '@ramu/shared/chat/agentTools'

/** What a read, edit or write row says before it is opened: the verb, the file's name, and for changes its line counts. */
export interface FileToolLine {
  verb: 'Read' | 'Edited' | 'Wrote'
  /** Path as the provider gave it; the row shows only `name`, the opened row and file links use this. */
  path: string
  /** File name with its extension, without folders. */
  name: string
  /** Further files the same call touched (Codex patches can change several). */
  others: number
  added?: number
  removed?: number
}

type ToolLike = AgentToolDetails & { name: string; summary: string }

const lines = (text: string) => (text ? text.replace(/\n$/, '').split('\n') : [])

/**
 * Lines a change adds and removes. Shared head and tail lines are skipped; the rest is compared exactly when small,
 * otherwise counted as replaced, so a huge rewrite cannot stall the transcript.
 */
export function lineChanges(before: string | null, after: string): { added: number; removed: number } {
  const a = lines(before ?? '')
  const b = lines(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const x = a.slice(start, endA)
  const y = b.slice(start, endB)
  if (!x.length || !y.length || x.length * y.length > 250_000) return { added: y.length, removed: x.length }
  // Longest common subsequence over the changed middle, one row at a time.
  let previous = new Uint32Array(y.length + 1)
  for (const line of x) {
    const row = new Uint32Array(y.length + 1)
    for (let j = 0; j < y.length; j++)
      row[j + 1] = line === y[j] ? previous[j]! + 1 : Math.max(previous[j + 1]!, row[j]!)
    previous = row
  }
  const common = previous[y.length]!
  return { added: y.length - common, removed: x.length - common }
}

const baseName = (path: string) =>
  path
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() || path

function parseInput(input: string | undefined): Record<string, unknown> {
  if (!input?.trim().startsWith('{')) return {}
  try {
    const value = JSON.parse(input) as unknown
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value : undefined)

/**
 * The compact row for a file tool from any provider: Claude's JSON input (file_path, old/new strings, edits, content),
 * ACP and Codex diff content or locations, or the summary as a last resort. Null for every other tool.
 */
export function fileToolLine(tool: ToolLike, result?: AgentToolDetails): FileToolLine | null {
  const kind = toolKind(tool)
  if (kind !== 'read' && kind !== 'edit') return null
  const input = parseInput(tool.input)
  const diffs = [...(tool.content ?? []), ...(result?.content ?? [])].filter(
    (item): item is Extract<AgentContent, { type: 'diff' }> => item.type === 'diff',
  )
  const paths = [
    ...diffs.map((diff) => diff.path),
    ...(tool.locations ?? []).map((location) => location.path),
    text(input.file_path) ?? text(input.path) ?? text(input.notebook_path),
  ].filter((path): path is string => Boolean(path?.trim()))
  if (!paths.length) {
    // Codex names every changed file in its summary, comma separated; others name one path, maybe with a line.
    const summary = tool.summary.trim()
    if (!summary || /^[{[]/.test(summary)) return null
    paths.push(...summary.split(/,\s+/).map((path) => path.replace(/:\d+(?::\d+)?$/, '')))
  }
  const unique = [...new Set(paths)]
  const path = unique[0]!
  const write = /^write$/i.test(tool.name) || (typeof input.content === 'string' && input.old_string === undefined)
  const line: FileToolLine = {
    verb: kind === 'read' ? 'Read' : write ? 'Wrote' : 'Edited',
    path,
    name: baseName(path),
    others: unique.length - 1,
  }
  if (kind === 'read') return line
  const count = (pairs: { before: string | null; after: string }[]) => {
    const totals = pairs.reduce(
      (sum, pair) => {
        const change = lineChanges(pair.before, pair.after)
        return { added: sum.added + change.added, removed: sum.removed + change.removed }
      },
      { added: 0, removed: 0 },
    )
    line.added = totals.added
    line.removed = totals.removed
  }
  if (diffs.length) count(diffs.map((diff) => ({ before: diff.oldText, after: diff.newText })))
  else if (typeof input.old_string === 'string' && typeof input.new_string === 'string')
    count([{ before: input.old_string, after: input.new_string }])
  else if (Array.isArray(input.edits))
    count(
      input.edits.flatMap((edit: Record<string, unknown>) =>
        typeof edit?.old_string === 'string' && typeof edit.new_string === 'string'
          ? [{ before: edit.old_string, after: edit.new_string }]
          : [],
      ),
    )
  else if (typeof input.content === 'string') line.added = lines(input.content).length
  return line
}

/**
 * The changes an edit or write made, for its opened row: the provider's own diff content, or one built from Claude's
 * old/new strings (a written file has no old text). Empty for reads and anything else.
 */
export function fileToolDiffs(tool: ToolLike, result?: AgentToolDetails): Extract<AgentContent, { type: 'diff' }>[] {
  const line = fileToolLine(tool, result)
  if (!line || line.verb === 'Read') return []
  const given = [...(tool.content ?? []), ...(result?.content ?? [])].filter(
    (item): item is Extract<AgentContent, { type: 'diff' }> => item.type === 'diff',
  )
  if (given.length) return given
  const input = parseInput(tool.input)
  if (typeof input.old_string === 'string' && typeof input.new_string === 'string')
    return [{ type: 'diff', path: line.path, oldText: input.old_string, newText: input.new_string }]
  if (Array.isArray(input.edits))
    return input.edits.flatMap((edit: Record<string, unknown>) =>
      typeof edit?.old_string === 'string' && typeof edit.new_string === 'string'
        ? [{ type: 'diff' as const, path: line.path, oldText: edit.old_string, newText: edit.new_string }]
        : [],
    )
  if (typeof input.content === 'string')
    return [{ type: 'diff', path: line.path, oldText: null, newText: input.content }]
  return []
}
