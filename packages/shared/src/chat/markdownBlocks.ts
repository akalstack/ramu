const LIST_ITEM = /^\s{0,3}(?:[-*+]|\d{1,9}[.)])\s/

/**
 * Markdown whose meaning crosses blank lines: reference definitions and footnotes resolve against the whole text, and
 * HTML or math blocks may hold blank lines of their own. Such text stays one block.
 */
const CROSSES_BLOCKS = /^\s{0,3}(?:\[[^\]]+\]:|\[\^[^\]]+\]|<[A-Za-z!/]|\$\$|:::)/m

/**
 * A reply's top-level blocks (paragraphs, headings, lists, tables, fenced code), each a Markdown source of its own, so a
 * streaming reply draws each block once and fades each new one in, while only the last is still growing. Blank lines
 * inside a fence stay in it, and a list or an indented continuation stays one block across the blank lines between its
 * items. Text that cannot be cut safely comes back whole.
 */
export function markdownBlocks(source: string): string[] {
  if (CROSSES_BLOCKS.test(source.replace(/\r/g, ''))) return source.trim() ? [source] : []
  const blocks: string[][] = []
  let current: string[] = []
  let fence: string | null = null
  let blank = false
  const close = () => {
    if (current.length) blocks.push(current)
    current = []
  }
  for (const line of source.split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      current.push(line)
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null
      continue
    }
    if (!line.trim()) {
      blank = true
      continue
    }
    if (blank && current.length) {
      const continues = /^\s/.test(line) || (LIST_ITEM.test(line) && LIST_ITEM.test(current[0]!))
      if (continues) current.push('')
      else close()
    }
    blank = false
    if (marker) fence = marker
    current.push(line)
  }
  close()
  return blocks.map((lines) => lines.join('\n'))
}
