/** A backlog drains over about this long, so a burst from the provider reads as steady writing rather than a jump. */
const CATCH_UP_MS = 400
/** The slowest it writes, in characters per second, so a short tail never crawls. */
const MIN_RATE = 120

const isWordChar = (character: string | undefined) => !!character && /\S/.test(character)

/**
 * How much of `text` to show after `elapsedMs` more of writing, from `shown`. The pace follows the backlog, the way chat
 * apps type out a reply, and it stops at the end of a word so none shows half-written.
 */
export function nextReveal(text: string, shown: number, elapsedMs: number): number {
  const backlog = text.length - shown
  if (backlog <= 0) return text.length
  const perMs = Math.max(MIN_RATE / 1000, backlog / CATCH_UP_MS)
  let next = Math.min(text.length, shown + Math.max(1, Math.round(perMs * elapsedMs)))
  if (next < text.length && isWordChar(text[next - 1]) && isWordChar(text[next])) {
    const end = text.slice(next).search(/\s/)
    next = end < 0 ? text.length : next + end
  }
  // Never split a character that takes two code units.
  const code = text.charCodeAt(next - 1)
  if (next < text.length && code >= 0xd800 && code <= 0xdbff) next++
  return next
}
