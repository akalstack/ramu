/** How much of a reply a thread row keeps: enough for two lines at large text. */
const PREVIEW_CHARS = 160

/**
 * The opening of an agent's reply as one plain line, for a thread row: code blocks, tables and Markdown marks are left
 * out and links keep their text, so the row reads like the reply's first sentences. Empty when nothing readable is left.
 */
export function replyPreview(text: string): string {
  const plain = text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>\n]+>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|\s)[*_](\S[^*_\n]*?)[*_](?=\s|[.,;:!?]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain.length <= PREVIEW_CHARS) return plain
  const cut = plain.slice(0, PREVIEW_CHARS)
  const space = cut.lastIndexOf(' ')
  return `${(space > PREVIEW_CHARS / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`
}
