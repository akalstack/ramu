/**
 * Links in terminal output: web addresses, and file paths as tools print them (`src/a.ts:12:3`, `./build/out.js`,
 * `/var/log/x.log`, TypeScript's `a.ts(12,3): error`). This file has no imports and no regex lookbehind: the phone's
 * terminal bundle embeds it as source text, and older iOS web views reject lookbehind outright.
 */

export type TerminalLinkKind = 'url' | 'path'

export interface TerminalLinkMatch {
  kind: TerminalLinkKind
  /** The URL, or the path with its `:line:column`. */
  text: string
  /** Character offsets in the line; `end` is exclusive. */
  start: number
  end: number
}

const URL_PATTERN = /\bhttps?:\/\/[^\s"'`<>]+/gi
const COMPILER_LOCATION = /([^\s"'`<>|(){}]+\.[A-Za-z][\w-]*)\((\d+),(\d+)\)(?=:\s+(?:error|warning)\b)/g
// `=`, `,` and brackets end a token so `--out=dist/a.js` and `(src/a.ts)` link only the path.
const TOKEN = /[^\s"'`<>|(){},;=]+/g
const DIFF_HEADER = /^(?:diff --git |--- |\+\+\+ )/

function trimToken(value: string): { text: string; lead: number } {
  let text = value,
    lead = 0
  while (text.startsWith('[') && count(text, '[') > count(text, ']')) {
    text = text.slice(1)
    lead++
  }
  for (;;) {
    const next = text.replace(/[.,:;!?]+$/, '')
    const unbalanced = next.endsWith(']') && count(next, ']') > count(next, '[') ? next.slice(0, -1) : next
    if (unbalanced === text) return { text, lead }
    text = unbalanced
  }
}

function count(text: string, char: string): number {
  return text.split(char).length - 1
}

function trimUrl(value: string): string {
  let text = value.replace(/[.,;:!?]+$/, '')
  for (const [open, close] of [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ] as const)
    while (text.endsWith(close) && count(text, close) > count(text, open)) text = text.slice(0, -1)
  return text.replace(/[.,;:!?]+$/, '')
}

/** Whether a token reads as a path rather than prose, a number, a host, a Git remote or a request route. */
function isPath(token: string): boolean {
  if (token.includes('://') || token.includes('?') || /^[\w.-]+@[\w.-]+:/.test(token)) return false
  const base = token.replace(/(?::\d+){1,2}$/, '')
  const positioned = base !== token
  if (!/[A-Za-z]/.test(base) || base.includes('//')) return false
  const drive = /^[A-Za-z]:[\\/]/.test(base)
  if ((drive ? base.slice(2) : base).includes(':')) return false
  if (drive || /^(?:\/|\.{1,2}[\\/]|~[\\/])./.test(base)) return true
  if (/[\\/]/.test(base)) return /^[\w@$+.-]/.test(base)
  // A bare `name.ext` links only with a position after it, so `example.com` and `v1.2` stay text.
  return positioned && /^[\w@$+-][\w@$+.-]*\.[A-Za-z][\w-]*$/.test(base)
}

/** The URLs and paths in one terminal line, in order and never overlapping. */
export function extractTerminalLinks(line: string): TerminalLinkMatch[] {
  const links: TerminalLinkMatch[] = []
  const free = (start: number, end: number) => links.every((link) => end <= link.start || start >= link.end)
  for (const match of line.matchAll(URL_PATTERN)) {
    const text = trimUrl(match[0])
    if (text.length > 'https://'.length)
      links.push({ kind: 'url', text, start: match.index, end: match.index + text.length })
  }
  for (const match of line.matchAll(COMPILER_LOCATION)) {
    const end = match.index + match[0].length
    if (free(match.index, end))
      links.push({ kind: 'path', text: `${match[1]}:${match[2]}:${match[3]}`, start: match.index, end })
  }
  const diff = DIFF_HEADER.test(line)
  for (const match of line.matchAll(TOKEN)) {
    const { text: trimmed, lead } = trimToken(match[0])
    const start = match.index + lead,
      end = start + trimmed.length
    if (!trimmed || !free(start, end) || !isPath(trimmed)) continue
    // `git diff` prints `a/src/x.ts` and `b/src/x.ts`; the file is `src/x.ts`.
    const text = diff && /^[ab]\/./.test(trimmed) ? trimmed.slice(2) : trimmed
    links.push({ kind: 'path', text, start, end })
  }
  return links.sort((a, b) => a.start - b.start)
}

/** One row of the terminal buffer, as xterm.js exposes it. */
export interface TerminalBufferLine {
  readonly isWrapped: boolean
  translateToString(trimRight?: boolean): string
}

export interface TerminalCell {
  /** Buffer row, from 0. */
  row: number
  /** Column, from 0. */
  column: number
}

export interface TerminalLinkRange extends Omit<TerminalLinkMatch, 'start' | 'end'> {
  start: TerminalCell
  /** The last cell of the link, inclusive. */
  end: TerminalCell
}

/**
 * The links in the logical line that holds `row`, with rows a long line wrapped onto joined first, so a URL or path
 * broken across rows is one link.
 */
export function terminalLinksAround(
  row: number,
  getLine: (row: number) => TerminalBufferLine | undefined,
): TerminalLinkRange[] {
  if (!getLine(row)) return []
  let first = row
  while (first > 0 && getLine(first)?.isWrapped) first--
  const rows: { row: number; offset: number }[] = []
  let text = ''
  for (let current = first; ; current++) {
    const line = getLine(current)
    if (!line) break
    const wraps = getLine(current + 1)?.isWrapped === true
    rows.push({ row: current, offset: text.length })
    text += line.translateToString(!wraps)
    if (!wraps) break
  }
  const cell = (offset: number): TerminalCell => {
    let at = rows[0]!
    for (const entry of rows) if (entry.offset <= offset) at = entry
    return { row: at.row, column: offset - at.offset }
  }
  return extractTerminalLinks(text).map((link) => ({
    kind: link.kind,
    text: link.text,
    start: cell(link.start),
    end: cell(link.end - 1),
  }))
}

/** The link under one cell, such as where a finger tapped. */
export function terminalLinkAt(
  cell: TerminalCell,
  getLine: (row: number) => TerminalBufferLine | undefined,
): TerminalLinkRange | null {
  const position = (at: TerminalCell) => at.row * 1e6 + at.column
  const tapped = position(cell)
  return (
    terminalLinksAround(cell.row, getLine).find(
      (link) => position(link.start) <= tapped && tapped <= position(link.end),
    ) ?? null
  )
}

/**
 * Where a path printed in a shell may point, most likely first: from the folder the shell started in, then as written,
 * so the host can still find it among the thread's folders after a `cd`.
 */
export function terminalPathTargets(path: string, cwd: string | null | undefined): string[] {
  const absolute = /^(?:\/|~[\\/]|[A-Za-z]:[\\/]|file:)/i.test(path)
  if (absolute || !cwd) return [path]
  const separator = cwd.includes('\\') && !cwd.includes('/') ? '\\' : '/'
  const joined = `${cwd.replace(/[\\/]+$/, '')}${separator}${path.replace(/^\.[\\/]/, '').replace(/[\\/]/g, separator)}`
  return joined === path ? [path] : [joined, path]
}

/** Whether a terminal link is a web address, which opens in a browser rather than the editor. */
export const isTerminalUrl = (text: string) => /^https?:\/\//i.test(text)
