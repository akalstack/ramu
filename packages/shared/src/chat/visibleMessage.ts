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

/** Separates what the person typed from the hidden context Ramu appends to a message for the agent. */
export const CONTEXT_MARKER = '\n\n<ramu-context>\n'

/** The text to send: what the person typed, then any hidden context for the agent in one block. */
export const withHiddenContext = (typed: string, hidden: string): string =>
  hidden ? `${typed}${CONTEXT_MARKER}${hidden}\n</ramu-context>` : typed

/** The origin of a message Ramu sends a thread by itself; `title` says what happened, the host adds the message. */
export const ramuMessage = (title: string, values?: Record<string, string>) => ({
  kind: 'ramu' as const,
  title,
  ...(values ? { values } : {}),
})

/** The whole message as the agent read it, its appended context as plain paragraphs, for the person to look into. */
export const agentReadable = (text: string): string =>
  text
    .replace(/\n*<ramu-context>\n?([\s\S]*?)\n?<\/ramu-context>/g, (_all, context: string) => `\n\n${context.trim()}`)
    .trim()
