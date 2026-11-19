import type { ReactNode } from 'react'

/** What the query box is asking for: everything, commands only (">"), or file contents only ("#"). */
export type QueryMode = 'all' | 'commands' | 'content'

export interface ParsedQuery {
  mode: QueryMode
  text: string
}

/** Splits the raw input into a mode prefix and the text each source sees. */
export function parsePaletteQuery(raw: string): ParsedQuery {
  if (raw.startsWith('>')) return { mode: 'commands', text: raw.slice(1).trim() }
  if (raw.startsWith('#')) return { mode: 'content', text: raw.slice(1).trim() }
  return { mode: 'all', text: raw.trim() }
}

export interface PaletteResult {
  /** Unique within its source. */
  key: string
  label: string
  /** Character offsets in `label` to highlight. */
  hits?: number[]
  detail?: string
  keys?: string
  icon?: ReactNode
  /** Match text split around the hit, for content results. */
  snippet?: { before: string; hit: string; after: string }
  /** How the result is opened. Called after the palette closes. */
  run: () => unknown
}

export interface PaletteBatch {
  results: PaletteResult[]
  /** The source had more than it returned. */
  limited?: boolean
}

export interface PaletteQueryContext {
  /** Aborted when a newer keystroke supersedes this query. */
  signal: AbortSignal
  /** Most results the palette will keep from this source. */
  limit: number
  mode: QueryMode
}

export type PaletteOutput = PaletteBatch | Promise<PaletteBatch> | AsyncIterable<PaletteBatch>

/**
 * A pluggable result source. Synchronous sources return a batch directly and run on every keystroke;
 * asynchronous ones (Promise or AsyncIterable) set `debounceMs` so typing never waits on them.
 */
export interface PaletteSource {
  id: string
  /** Group heading, already translated. */
  label: string
  /** Groups are shown in ascending priority. */
  priority: number
  /** Modes in which the source takes part. */
  modes: readonly QueryMode[]
  /** Shortest query text that runs the source. */
  minLength: number
  /** Shortest text when the user targeted the source with its own prefix mode. Defaults to `minLength`. */
  minLengthExplicit?: number
  /** 0 runs synchronously on every keystroke. */
  debounceMs: number
  /** Hard cap on results kept; anything more marks the group as limited. */
  limit: number
  /** Results shown before "show more". */
  initialShow: number
  /** Changes when a running query is no longer valid (for example another project). */
  scope?: string
  query(text: string, context: PaletteQueryContext): PaletteOutput
}

/** The text length a source needs before it may run in this mode. */
export function minLengthFor(source: PaletteSource, mode: QueryMode): number {
  return mode !== 'all' ? (source.minLengthExplicit ?? source.minLength) : source.minLength
}

/** Whether the source takes part for this query. */
export function sourceApplies(source: PaletteSource, { mode, text }: ParsedQuery): boolean {
  return source.modes.includes(mode) && text.length >= minLengthFor(source, mode)
}

/** Keeps the first `limit` results and reports whether any were dropped. */
export function capResults<T>(results: readonly T[], limit: number): { results: T[]; limited: boolean } {
  return results.length > limit
    ? { results: results.slice(0, limit), limited: true }
    : { results: [...results], limited: false }
}

export function isBatch(output: PaletteOutput): output is PaletteBatch {
  return Array.isArray((output as PaletteBatch).results)
}

export function isAsyncIterable(output: PaletteOutput): output is AsyncIterable<PaletteBatch> {
  return typeof (output as AsyncIterable<PaletteBatch>)[Symbol.asyncIterator] === 'function'
}

/**
 * The `n` best-scoring items, best first, without sorting everything: the buffer is trimmed
 * whenever it reaches 2n, so a pass over m items costs O(m log n). `total` counts every item that scored.
 */
export function rankTop<T>(items: Iterable<T>, score: (item: T) => number | null, n: number) {
  let buffer: { item: T; score: number }[] = []
  let total = 0
  const trim = () => {
    buffer.sort((a, b) => b.score - a.score)
    buffer = buffer.slice(0, n)
  }
  for (const item of items) {
    const value = score(item)
    if (value === null) continue
    total++
    buffer.push({ item, score: value })
    if (buffer.length >= 2 * n) trim()
  }
  trim()
  return { items: buffer.map((entry) => entry.item), total }
}

/** Which prefix the palette opens with: ">" for commands, nothing for files. */
export type PaletteMode = 'commands' | 'files'
