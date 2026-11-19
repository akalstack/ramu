/** Rendered text compares by its words: case, spacing and Markdown marks a quote may still carry do not count. */
const fold = (character: string) => (/\s/.test(character) ? ' ' : character.toLowerCase())
const MARKS = /[*_`~#>|]/
const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, td, th, tr, div'

/**
 * Where a quote sits in a rendered message, as a DOM range over just that text. Null when the message does not hold it
 * word for word; a quote trimmed at its end still matches the part it kept.
 */
export function quoteRange(element: HTMLElement, quote: string): Range | null {
  const needle = quote
    .replace(/^>\s?/gm, '')
    .split('')
    .filter((character) => !MARKS.test(character))
    .map(fold)
    .join('')
    .replace(/ +/g, ' ')
    .trim()
  if (!needle) return null
  // The message's text with each folded character's place in its text node, spaces collapsed as in the needle.
  let text = ''
  const places: { node: Text; offset: number }[] = []
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let block: Element | null = null
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    // A new paragraph, item or cell reads as a new word even when the DOM puts no space between them.
    const owner = node.parentElement?.closest(BLOCKS) ?? null
    if (owner !== block && text && !text.endsWith(' ')) {
      text += ' '
      places.push({ node, offset: 0 })
    }
    block = owner
    const value = node.data
    for (let offset = 0; offset < value.length; offset++) {
      const character = fold(value[offset]!)
      if (character === ' ' && (text.endsWith(' ') || !text)) continue
      text += character
      places.push({ node, offset })
    }
  }
  const at = text.indexOf(needle)
  if (at < 0) return null
  const start = places[at]!,
    end = places[at + needle.length - 1]!
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, Math.min(end.offset + 1, end.node.data.length))
  return range
}
