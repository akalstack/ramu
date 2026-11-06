// Git conflict markers in a file, read and resolved the same way on the host and in the apps.

/** Which side of a conflict to keep. `both` keeps the current side, then the incoming one, as editors do. */
export type ConflictChoice = 'current' | 'incoming' | 'both'

export interface ConflictHunk {
  index: number
  /** Zero-based line of the `<<<<<<<` marker. */
  line: number
  /** What the branch you are on has: the side above `=======`. */
  current: string[]
  /** The common ancestor, when the repository writes diff3 markers. */
  base: string[] | null
  /** What is being merged or replayed in: the side below `=======`. */
  incoming: string[]
  /** The names after the markers, such as `HEAD` and the other branch. */
  currentLabel: string
  incomingLabel: string
}

const START = /^<{7}(?: (.*))?$/
const BASE = /^\|{7}(?: .*)?$/
const MIDDLE = /^={7}$/
const END = /^>{7}(?: (.*))?$/

const lines = (text: string) => text.split(/\r?\n/)
const eol = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n')

/** The conflict hunks in a file. A start marker without its middle and end is left as text, not a hunk. */
export function parseConflicts(text: string): ConflictHunk[] {
  const all = lines(text)
  const hunks: ConflictHunk[] = []
  for (let i = 0; i < all.length; i++) {
    const start = START.exec(all[i]!)
    if (!start) continue
    let j = i + 1
    const current: string[] = []
    let base: string[] | null = null
    while (j < all.length && !MIDDLE.test(all[j]!) && !BASE.test(all[j]!) && !START.test(all[j]!))
      current.push(all[j++]!)
    if (j < all.length && BASE.test(all[j]!)) {
      base = []
      j++
      while (j < all.length && !MIDDLE.test(all[j]!) && !START.test(all[j]!)) base.push(all[j++]!)
    }
    if (j >= all.length || !MIDDLE.test(all[j]!)) continue
    j++
    const incoming: string[] = []
    while (j < all.length && !END.test(all[j]!) && !START.test(all[j]!)) incoming.push(all[j++]!)
    const end = j < all.length ? END.exec(all[j]!) : null
    if (!end) continue
    hunks.push({
      index: hunks.length,
      line: i,
      current,
      base,
      incoming,
      currentLabel: (start[1] ?? '').trim(),
      incomingLabel: (end[1] ?? '').trim(),
    })
    i = j
  }
  return hunks
}

/**
 * The file with conflicts replaced by the chosen side. `choices` maps a hunk index to its side; a hunk without a
 * choice keeps its markers. Everything outside the hunks, including what Git merged cleanly, is kept as it is.
 */
export function resolveConflicts(text: string, choices: Map<number, ConflictChoice> | ConflictChoice): string {
  const all = lines(text)
  const hunks = parseConflicts(text)
  const out: string[] = []
  let at = 0
  for (const hunk of hunks) {
    const choice = typeof choices === 'string' ? choices : choices.get(hunk.index)
    const length = 1 + hunk.current.length + (hunk.base ? hunk.base.length + 1 : 0) + 1 + hunk.incoming.length + 1
    out.push(...all.slice(at, hunk.line))
    if (!choice) out.push(...all.slice(hunk.line, hunk.line + length))
    else
      out.push(
        ...(choice === 'current'
          ? hunk.current
          : choice === 'incoming'
            ? hunk.incoming
            : [...hunk.current, ...hunk.incoming]),
      )
    at = hunk.line + length
  }
  out.push(...all.slice(at))
  return out.join(eol(text))
}
