const KINDS = ['marker', 'strong', 'emphasis', 'strike', 'code', 'heading', 'quote', 'link'] as const
export type MarkdownMark = (typeof KINDS)[number]

/** A stretch of source text with the same styling. Joined back together, runs equal the source exactly. */
export interface MarkdownRun {
  text: string
  marks: MarkdownMark[]
}

/** Past this a draft is pasted data, not something being written, and redrawing it on every key would lag. */
const MAX_STYLED = 20_000

const bit = (kind: MarkdownMark) => 1 << KINDS.indexOf(kind)

/**
 * Splits a draft into styled runs for the composer, which shows the Markdown as it is typed and keeps every character.
 * This is a highlighter rather than a parser: it only has to look right while typing, the sent message is rendered
 * properly. Words like snake_case stay plain, and nothing inside code is styled.
 */
export function markdownRuns(source: string): MarkdownRun[] {
  if (!source) return []
  if (source.length > MAX_STYLED) return [{ text: source, marks: [] }]
  const flags = new Array<number>(source.length).fill(0)
  const code = new Array<boolean>(source.length).fill(false)
  const paint = (start: number, end: number, kind: MarkdownMark) => {
    for (let index = start; index < end; index++) flags[index]! |= bit(kind)
  }
  const isCode = (index: number) => code[index]
  const shield = (start: number, end: number) => code.fill(true, start, end)

  for (const match of source.matchAll(/^(```|~~~)[^\n]*(?:\n[\s\S]*?(?:\n\1[ \t]*(?=\n|$)|$(?![\s\S])))?/gm)) {
    const end = match.index + match[0].length
    paint(match.index, end, 'code')
    shield(match.index, end)
  }
  for (const match of source.matchAll(/`[^`\n]+`/g)) {
    if (isCode(match.index)) continue
    const end = match.index + match[0].length
    paint(match.index, match.index + 1, 'marker')
    paint(end - 1, end, 'marker')
    paint(match.index, end, 'code')
    shield(match.index, end)
  }
  for (const match of source.matchAll(/^(#{1,6} |> ?|\s*(?:[-*+]|\d+\.) )(.*)$/gm)) {
    if (isCode(match.index)) continue
    const lead = match[1]!
    const bodyStart = match.index + lead.length
    paint(match.index, bodyStart, 'marker')
    if (lead.startsWith('#')) paint(bodyStart, match.index + match[0].length, 'heading')
    else if (lead.startsWith('>')) paint(bodyStart, match.index + match[0].length, 'quote')
  }
  const pair = (pattern: RegExp, size: number, kind: MarkdownMark) => {
    for (const match of source.matchAll(pattern)) {
      if (isCode(match.index)) continue
      const end = match.index + match[0].length
      paint(match.index, match.index + size, 'marker')
      paint(end - size, end, 'marker')
      paint(match.index + size, end - size, kind)
    }
  }
  pair(/\*\*(?=\S)[^\n]+?(?<=\S)\*\*/g, 2, 'strong')
  pair(/(?<!\w)__(?=\S)[^\n]+?(?<=\S)__(?!\w)/g, 2, 'strong')
  pair(/(?<![*\w])\*(?=[^\s*])[^*\n]+?(?<=\S)\*(?![*\w])/g, 1, 'emphasis')
  pair(/(?<![_\w])_(?=[^\s_])[^_\n]+?(?<=\S)_(?![_\w])/g, 1, 'emphasis')
  pair(/~~(?=\S)[^\n]+?(?<=\S)~~/g, 2, 'strike')
  for (const match of source.matchAll(/\[([^\]\n]+)\]\(([^)\s]+)\)/g)) {
    if (isCode(match.index)) continue
    const labelEnd = match.index + 1 + match[1]!.length
    paint(match.index, match.index + 1, 'marker')
    paint(match.index + 1, labelEnd, 'link')
    paint(labelEnd, match.index + match[0].length, 'marker')
  }

  const runs: MarkdownRun[] = []
  let start = 0
  for (let index = 1; index <= source.length; index++) {
    if (index < source.length && flags[index] === flags[start]) continue
    const value = flags[start]!
    runs.push({ text: source.slice(start, index), marks: KINDS.filter((kind) => value & bit(kind)) })
    start = index
  }
  return runs
}
