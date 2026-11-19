// A long message you sent (a pasted log, a file, a long brief) shows its beginning until you expand it. Drawn whole, it
// pushed the reply off screen and, past a few thousand points tall, iOS left the bubble blank. No React Native imports.

const MAX_LINES = 12
const MAX_CHARS = 900

/** The start of a long markdown message, cut at a line and with any code fence it opened closed; null when it is short. */
export function messagePreview(text: string, maxLines = MAX_LINES, maxChars = MAX_CHARS): string | null {
  const lines = text.split('\n')
  if (lines.length <= maxLines + 4 && text.length <= maxChars * 1.5) return null
  const kept: string[] = []
  let length = 0
  for (const line of lines) {
    if (kept.length >= maxLines || (kept.length && length + line.length > maxChars)) break
    kept.push(line.length > maxChars ? `${line.slice(0, maxChars)}…` : line)
    length += line.length + 1
  }
  const fences = kept.filter((line) => /^\s*(```|~~~)/.test(line)).length
  if (fences % 2) kept.push('```')
  return kept.join('\n')
}
