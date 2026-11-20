// Raw PTY output as the lines a person saw: colors and cursor codes removed, a line redrawn in place (progress bars,
// spinners) kept as its last state, and backspaces applied.

// eslint-disable-next-line no-control-regex
const CONTROL = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[PX^_][^\x1b]*\x1b\\|[@-Z\\-_]|.)/g
// eslint-disable-next-line no-control-regex
const OTHER = /[\x00-\x07\x0b\x0c\x0e-\x1f\x7f]/g

function settle(line: string): string {
  // A carriage return moves to the start of the row: later text overwrites earlier text, character by character.
  let row: string[] = []
  for (const part of line.split('\r')) {
    const chars = [...part]
    row = [...chars, ...row.slice(chars.length)]
  }
  const out: string[] = []
  for (const char of row) {
    if (char === '\b') out.pop()
    else out.push(char)
  }
  return out.join('').replace(OTHER, '').trimEnd()
}

/** Plain lines of terminal output. */
export function terminalPlainLines(raw: string): string[] {
  return raw.replace(CONTROL, '').replace(/\r+\n/g, '\n').split('\n').map(settle)
}

/** The last `count` lines of terminal output as plain text, without the blank rows after the last output. */
export function terminalTail(raw: string, count: number): { text: string; lines: number; total: number } {
  const all = terminalPlainLines(raw)
  while (all.length && !all.at(-1)) all.pop()
  const kept = all.slice(-count)
  return { text: kept.join('\n'), lines: kept.length, total: all.length }
}
