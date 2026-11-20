// What "Add to chat" takes from a terminal: the selection when there is one, otherwise the rows on screen.

interface BufferLine {
  isWrapped: boolean
  translateToString(trimRight?: boolean): string
}

/** The part of xterm's Terminal a capture reads. */
export interface CaptureSource {
  rows: number
  hasSelection(): boolean
  getSelection(): string
  getSelectionPosition(): { start: { y: number }; end: { y: number } } | undefined
  buffer: { active: { viewportY: number; getLine(y: number): BufferLine | undefined } }
}

export interface TerminalCapture {
  text: string
  /** First and last buffer line, 1-based. */
  lines: [number, number]
  selection: boolean
}

export function captureTerminal(term: CaptureSource): TerminalCapture | null {
  if (term.hasSelection()) {
    const position = term.getSelectionPosition()
    const text = term.getSelection()
    if (position && text.trim()) {
      const start = position.start.y + 1
      return { text, lines: [start, Math.max(start, position.end.y + 1)], selection: true }
    }
  }
  // Rows a long line wrapped onto join the row before them, so a wrapped path or URL stays whole.
  const buffer = term.buffer.active
  const top = buffer.viewportY
  let text = ''
  let first = -1
  let last = -1
  for (let y = top; y < top + term.rows; y++) {
    const line = buffer.getLine(y)
    if (!line) break
    const row = line.translateToString(true)
    text += y === top || line.isWrapped ? row : `\n${row}`
    if (row.trim()) {
      if (first < 0) first = y
      last = y
    }
  }
  return last < 0 ? null : { text, lines: [first + 1, last + 1], selection: false }
}
