/**
 * Text as read, for comparing a quote with the message it came from: a quote is copied from rendered text, so Markdown
 * marks, line breaks and case in the source must not stop a match.
 */
const plain = (text: string) =>
  text
    .replace(/^>\s?/gm, '')
    .replace(/[*_`~#>[\]()|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/**
 * The newest message a quote came from, among `messages` in conversation order. Its first 80 readable characters are
 * enough to tell, and survive a quote that was trimmed at the end. Null when none holds it.
 */
export function quoteSource<T extends { text: string }>(messages: readonly T[], quote: string): T | null {
  const needle = plain(quote).slice(0, 80)
  if (!needle) return null
  for (let index = messages.length - 1; index >= 0; index--)
    if (plain(messages[index]!.text).includes(needle)) return messages[index]!
  return null
}
