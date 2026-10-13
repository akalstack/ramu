/**
 * Subsequence fuzzy match. Rewards consecutive runs and matches at word or path-segment
 * starts, and prefers matches in the file name over the directory. Returns null when
 * not every query character appears in order.
 */
export function fuzzy(query: string, target: string): { score: number; hits: number[] } | null {
  if (!query) return { score: 0, hits: [] }
  const q = query.toLowerCase().replace(/\s+/g, '')
  const t = target.toLowerCase()
  const nameStart = target.lastIndexOf('/') + 1
  const hits: number[] = []
  let score = 0
  let ti = 0
  let prev = -2
  for (const ch of q) {
    const idx = t.indexOf(ch, ti)
    if (idx < 0) return null
    hits.push(idx)
    const before = target[idx - 1]
    let s = 1
    if (idx === prev + 1) s += 5
    if (idx === 0 || before === '/' || before === ' ' || before === '-' || before === '_' || before === '.') s += 4
    else if (target[idx] !== target[idx]!.toLowerCase() && before === before?.toLowerCase()) s += 3 // camelCase hump
    if (idx >= nameStart) s += 2
    score += s
    prev = idx
    ti = idx + 1
  }
  // Shorter targets and earlier first matches read as better matches.
  score -= target.length * 0.02 + hits[0]! * 0.05
  return { score, hits }
}

/** Splits text into runs for highlighting matched characters. */
export function highlight(text: string, hits: number[]): { text: string; hit: boolean }[] {
  const set = new Set(hits)
  const out: { text: string; hit: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i)
    const last = out.at(-1)
    if (last && last.hit === hit) last.text += text[i]
    else out.push({ text: text[i]!, hit })
  }
  return out
}
