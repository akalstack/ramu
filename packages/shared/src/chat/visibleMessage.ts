/**
 * Blocks Ramu puts in front of a message for the agent: a teammate's catch-up, the session's tool guidance, a helper's
 * view of the conversation, a handoff note. The person never typed them, so a message shows without them.
 */
const LEADING_BLOCKS = ['thread-catch-up', 'ramu-session-guidance', 'chat-context', 'ramu-handoff']
const LEADING = new RegExp(`^\\s*<(${LEADING_BLOCKS.join('|')})>[\\s\\S]*?</\\1>\\s*`)

/** What the person wrote: Ramu's leading blocks and the context it appends (`<ramu-context>…`) are left out. */
export function visibleMessage(text: string): string {
  let rest = text
  for (let match = LEADING.exec(rest); match; match = LEADING.exec(rest)) rest = rest.slice(match[0].length)
  return rest.split(/\n*<ramu-context>/)[0]!.trimEnd()
}
