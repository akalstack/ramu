/**
 * Blocks Ramu puts in front of a message for the agent: the session's tool guidance, a helper's
 * view of the conversation, a handoff note. The person never typed them, so a message shows without them.
 */
const LEADING_BLOCKS = ['ramu-session-guidance', 'chat-context', 'ramu-handoff']
const LEADING = new RegExp(`^\\s*<(${LEADING_BLOCKS.join('|')})>[\\s\\S]*?</\\1>\\s*`)

/** What the person wrote: Ramu's leading blocks and the context it appends (`<ramu-context>…`) are left out. */
export function visibleMessage(text: string): string {
  let rest = text
  for (let match = LEADING.exec(rest); match; match = LEADING.exec(rest)) rest = rest.slice(match[0].length)
  return rest.split(/\n*<ramu-context>/)[0]!.trimEnd()
}

/** Replaces what the person wrote, keeping Ramu's leading blocks and appended context exactly as they were. */
export function replaceVisibleMessage(text: string, next: string): string {
  let start = 0
  for (let match = LEADING.exec(text.slice(start)); match; match = LEADING.exec(text.slice(start)))
    start += match[0].length
  const context = /\n*<ramu-context>/.exec(text.slice(start))
  return `${text.slice(0, start)}${next}${context ? text.slice(start + context.index) : ''}`
}
