// Command blocks in a terminal: a command and the output it printed, so one action copies both. A shell that marks its
// prompts (OSC 133, which iTerm2, VS Code, WezTerm and Ghostty shell integration print) divides them exactly. Otherwise
// each Enter typed at the shell starts a block on the row it was typed on, which covers a plain zsh or bash prompt.
//
// The phone's terminal page bundles this file as source text (apps/mobile/scripts/gen-terminal.mjs), so it imports
// nothing and keeps to what older phone web views run.

export interface BlockBufferLine {
  isWrapped: boolean
  translateToString(trimRight?: boolean): string
}

export interface BlockBuffer {
  getLine(y: number): BlockBufferLine | undefined
}

/** Buffer rows, 0-based and inclusive. */
export interface BlockRange {
  start: number
  end: number
}

/** The first row of the line `y` belongs to: a long line the terminal wrapped starts on an earlier row. */
export function lineStart(buffer: BlockBuffer, y: number): number {
  let row = y
  while (row > 0 && buffer.getLine(row)?.isWrapped) row--
  return row
}

/** Rows as text. Rows a long line wrapped onto join the row before them, and blank rows at the end are left off. */
export function terminalRowsText(buffer: BlockBuffer, range: BlockRange): string {
  const lines: string[] = []
  for (let y = range.start; y <= range.end; y++) {
    const line = buffer.getLine(y)
    if (!line) break
    // A row that continues on the next keeps its trailing spaces: they are part of the line, not padding.
    const row = line.translateToString(!buffer.getLine(y + 1)?.isWrapped)
    if (line.isWrapped && lines.length) lines[lines.length - 1] += row
    else lines.push(row)
  }
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop()
  return lines.join('\n')
}

/** Blocks from their first rows: each runs to the row before the next, and the newest to `newestEnd`. Oldest first. */
export function terminalBlockRanges(starts: readonly number[], newestEnd: number): BlockRange[] {
  const sorted = [...new Set(starts)].filter((row) => row >= 0).sort((a, b) => a - b)
  return sorted.map((start, index) => ({
    start,
    end: index + 1 < sorted.length ? sorted[index + 1]! - 1 : Math.max(start, newestEnd),
  }))
}

/** The block holding `row`; a row below the newest block (the prompt waiting for input) belongs to it. */
export function terminalBlockAt(blocks: readonly BlockRange[], row: number): BlockRange | null {
  for (let index = blocks.length - 1; index >= 0; index--) if (blocks[index]!.start <= row) return blocks[index]!
  return null
}

/**
 * Whether Enter on this row runs nothing: the row is blank, or it is only the prompt the previous command was typed
 * after (ending in a prompt sign such as `$`, `%` or `❯`), so pressing Enter there does not start a block.
 */
export function isEmptyCommand(row: string, previousCommandRow: string | undefined): boolean {
  const text = row.trimEnd()
  if (!text.trim()) return true
  return !!previousCommandRow && previousCommandRow.startsWith(text) && /[$%#>❯➜λ»]$/u.test(text)
}

interface BlockMarker {
  readonly line: number
  readonly isDisposed: boolean
  dispose(): void
}

/** The part of xterm's Terminal the tracker uses. */
export interface BlockTerminal {
  buffer: {
    active: { type: string }
    normal: BlockBuffer & { baseY: number; cursorY: number }
  }
  registerMarker(cursorYOffset?: number): BlockMarker | undefined
  parser: { registerOscHandler(ident: number, callback: (data: string) => boolean): { dispose(): void } }
}

export interface TerminalBlocks {
  /** Pass what the person sends to the shell; an Enter at the shell starts a block unless the shell marks prompts. */
  input(data: string): void
  /** Finished and running blocks, oldest first; none while a full-screen program (an editor, `less`) is open. */
  blocks(): BlockRange[]
  text(range: BlockRange): string
  dispose(): void
}

const MAX_BLOCKS = 1000

export function trackTerminalBlocks(term: BlockTerminal): TerminalBlocks {
  let marks: BlockMarker[] = []
  let prompts = false
  // The newest prompt mark has no command after it yet, so it is not a block to copy.
  let waiting = false
  const normal = term.buffer.normal
  const live = () => (marks = marks.filter((mark) => !mark.isDisposed && mark.line >= 0))
  const newest = () => {
    const kept = live()
    return kept[kept.length - 1]
  }
  const cursorRow = () => normal.baseY + normal.cursorY
  const mark = () => {
    if (term.buffer.active.type !== 'normal') return
    const marker = term.registerMarker(0)
    if (!marker) return
    if (newest()?.line === marker.line) return marker.dispose()
    marks.push(marker)
    if (marks.length > MAX_BLOCKS) marks.shift()?.dispose()
  }
  const osc = term.parser.registerOscHandler(133, (data) => {
    if (data.startsWith('A')) {
      // Marks the shell prints are exact; the ones guessed from Enter before it started printing them are dropped.
      if (!prompts) for (const old of marks) old.dispose()
      if (!prompts) marks = []
      prompts = true
      mark()
      waiting = true
    } else if (data.startsWith('C')) waiting = false
    return false
  })
  return {
    input(data) {
      if (prompts || !data.endsWith('\r') || data.includes('\x1b[200~') || term.buffer.active.type !== 'normal') return
      const row = cursorRow()
      const command = terminalRowsText(normal, { start: lineStart(normal, row), end: row })
      const previous = newest()
      const previousText = previous
        ? terminalRowsText(normal, { start: lineStart(normal, previous.line), end: previous.line })
        : undefined
      if (!isEmptyCommand(command, previousText)) mark()
    },
    blocks() {
      if (term.buffer.active.type !== 'normal') return []
      const starts = live().map((marker) => lineStart(normal, marker.line))
      const cursor = cursorRow()
      // Without prompt marks the row the cursor waits on is the next prompt, not output.
      const ranges = terminalBlockRanges(starts, prompts ? cursor : cursor - 1)
      return prompts && waiting ? ranges.slice(0, -1) : ranges
    },
    text: (range) => terminalRowsText(normal, range),
    dispose() {
      osc.dispose()
      for (const old of marks) old.dispose()
      marks = []
    },
  }
}
