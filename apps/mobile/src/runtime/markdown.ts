// Block-level Markdown for the phone's native renderer (components/Markdown.tsx). Pure, so it is unit-tested in Node.

export type Block =
  | { kind: 'code'; source: string; lang?: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'rule' }
  | { kind: 'image'; alt: string; src: string }
  | { kind: 'quote'; text: string }
  | {
      kind: 'list'
      items: { depth: number; marker: string; ordered: boolean; task?: boolean; done?: boolean; text: string }[]
    }
  | { kind: 'table'; head: string[]; rows: string[][]; align: ('left' | 'center' | 'right')[] }
  | { kind: 'paragraph'; text: string }

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const FENCE = /^\s*(```+|~~~+)\s*([^\s`]*)/
const isRow = (line: string) => line.includes('|')
const isDivider = (line: string) => line.includes('|') && /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line)
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'))
const starts = (line: string) =>
  FENCE.test(line) ||
  /^#{1,6}\s/.test(line) ||
  /^\s*>/.test(line) ||
  LIST.test(line) ||
  /^\s*([-*_])(\s*\1){2,}\s*$/.test(line)

/** Splits Markdown into blocks the way GitHub does for the parts agents use. An unclosed fence (still streaming) runs to the end. */
export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!
    if (!line.trim()) {
      i++
      continue
    }
    const fence = line.match(FENCE)
    if (fence) {
      const body: string[] = []
      i++
      while (
        i < lines.length &&
        !new RegExp(`^\\s*${fence[1]![0] === '`' ? '`' : '~'}{${fence[1]!.length},}\\s*$`).test(lines[i]!)
      )
        body.push(lines[i++]!)
      i++
      blocks.push({ kind: 'code', source: body.join('\n'), lang: fence[2] || undefined })
      continue
    }
    const image = line.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/)
    if (image) {
      blocks.push({ kind: 'image', alt: image[1]!, src: image[2]! })
      i++
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! })
      i++
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: 'rule' })
      i++
      continue
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s*> ?/, ''))
      blocks.push({ kind: 'quote', text: body.join('\n') })
      continue
    }
    if (isRow(line) && i + 1 < lines.length && isDivider(lines[i + 1]!)) {
      const head = cells(line)
      const align = cells(lines[i + 1]!).map((cell) =>
        cell.startsWith(':') && cell.endsWith(':')
          ? ('center' as const)
          : cell.endsWith(':')
            ? ('right' as const)
            : ('left' as const),
      )
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i]!.trim() && isRow(lines[i]!)) rows.push(cells(lines[i++]!))
      blocks.push({ kind: 'table', head, rows, align })
      continue
    }
    if (LIST.test(line)) {
      const items: Extract<Block, { kind: 'list' }>['items'] = []
      const base = line.match(LIST)![1]!.length
      while (i < lines.length) {
        const current = lines[i]!
        const item = current.match(LIST)
        if (item) {
          const task = item[3]!.match(/^\[([ xX])\]\s+(.*)$/)
          items.push({
            depth: Math.min(4, Math.floor(Math.max(0, item[1]!.length - base) / 2)),
            marker: item[2]!,
            ordered: /\d/.test(item[2]!),
            ...(task ? { task: true, done: task[1] !== ' ', text: task[2]! } : { text: item[3]! }),
          })
          i++
        } else if (FENCE.test(current)) break
        else if (current.trim() && /^\s+/.test(current) && items.length) {
          items.at(-1)!.text += `\n${current.trim()}`
          i++
        } else if (!current.trim() && i + 1 < lines.length && LIST.test(lines[i + 1]!)) i++
        else break
      }
      blocks.push({ kind: 'list', items })
      continue
    }
    const body: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      (!body.length || !starts(lines[i]!)) &&
      !(isRow(lines[i]!) && i + 1 < lines.length && isDivider(lines[i + 1]!))
    )
      body.push(lines[i++]!)
    blocks.push({ kind: 'paragraph', text: body.join('\n') })
  }
  return blocks
}

/**
 * A very long paragraph as pieces of at most about `max` characters, cut at a line break, else a sentence, else a space.
 * iOS draws one Text into one layer; a paragraph many screens tall exceeds what it can draw and shows as a blank slab.
 */
export function splitLongParagraph(text: string, max = 1500): string[] {
  if (text.length <= max) return [text]
  const pieces: string[] = []
  let rest = text
  while (rest.length > max) {
    const window = rest.slice(0, max)
    const cut =
      [window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf(' ')].find((index) => index > max / 3) ??
      max
    pieces.push(rest.slice(0, cut + 1).trimEnd())
    rest = rest.slice(cut + 1).replace(/^\n/, '')
  }
  if (rest) pieces.push(rest)
  return pieces
}
