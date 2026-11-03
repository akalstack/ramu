/**
 * A run of a message's rendered text: plain text counts its own length, while an inline view (a code pill, a file
 * badge) is one placeholder character on screen but copies as its full `text`.
 */
export type TextRun = { text: string; atom?: boolean }

/** The text a native selection covers, from its UTF-16 `start` and `end` in the rendered string. */
export function selectedText(runs: readonly TextRun[], start: number, end: number): string {
  let at = 0
  let out = ''
  for (const run of runs) {
    const length = run.atom ? 1 : run.text.length
    const from = Math.max(start, at)
    const to = Math.min(end, at + length)
    if (from < to) out += run.atom ? run.text : run.text.slice(from - at, to - at)
    at += length
    if (at >= end) break
  }
  return out
}
