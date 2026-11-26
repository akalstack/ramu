import type { AsideMessage } from '../types'

const quoted = (text: string) =>
  text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')

/**
 * A side chat as the opening of a new thread's message: each passage it asked about, each question, and each answer
 * quoted under its question, ending on an empty line for what the person wants done with it. Answers that failed are
 * left out.
 */
export function asideDraft(messages: readonly (AsideMessage & { quote?: string })[]): string {
  const parts: string[] = []
  for (const message of messages) {
    if (message.error || !message.text.trim()) continue
    if (message.quote?.trim()) parts.push(quoted(message.quote))
    parts.push(message.role === 'user' ? message.text.trim() : quoted(message.text))
  }
  return parts.length ? `${parts.join('\n\n')}\n\n` : ''
}
