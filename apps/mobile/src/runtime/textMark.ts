/**
 * Code, link targets and inline HTML or autolinks: a highlight marker inside them would show as literal `==` or break
 * the link, so only the text between them is marked.
 */
const PROTECTED = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|\]\([^)\n]*\)|<[^>\n]+>)/g

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The Markdown source with every occurrence of the needles wrapped in `==` highlight markers, so the words a search or
 * quote led to light up rather than the whole message. Case is ignored and any run of spaces in a needle matches any
 * run in the text. Null when nothing could be marked, so the caller can light up the whole row instead.
 */
export function markSource(source: string, needles: readonly string[]): string | null {
  const patterns = needles
    .map((needle) => needle.trim())
    .filter((needle) => needle.length > 0)
    .map((needle) => needle.split(/\s+/).map(escape).join('\\s+'))
  if (!patterns.length) return null
  // Longest first, so a needle inside another does not split the longer one's highlight.
  patterns.sort((a, b) => b.length - a.length)
  const match = new RegExp(`(?:${patterns.join('|')})`, 'gi')
  let marked = false
  const result = source
    .split(PROTECTED)
    .map((part, index) =>
      // `split` with a capturing group puts the protected parts at odd indices.
      index % 2
        ? part
        : part.replace(match, (found) => {
            if (/\n\s*\n/.test(found)) return found
            marked = true
            return `==${found}==`
          }),
    )
    .join('')
  return marked ? result : null
}

/**
 * The lines of a quote worth finding in its message: a quote is copied from rendered text, so each line is looked for on
 * its own, without the list or quote marks it may carry, and lines too short to tell apart are left out.
 */
export function quoteNeedles(quote: string): string[] {
  return quote
    .split('\n')
    .map((line) => line.replace(/^\s*(?:>\s?|[-*+]\s+|\d+[.)]\s+)/, '').trim())
    .filter((line) => line.length >= 3)
}
