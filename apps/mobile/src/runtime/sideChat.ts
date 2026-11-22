import type { Aside, AsideMessage } from '@ramu/shared/types'

/**
 * A thread's side questions as one chat, the way Claude's /btw works: every aside the host holds is read as one
 * conversation in time order, a quoted passage shown before the question that asked about it, and new questions
 * continue the latest aside.
 */
export function sideChat(asides: readonly Aside[]): {
  messages: (AsideMessage & { quote?: string })[]
  /** The aside new questions continue; null starts the first. */
  continueId: string | null
  /** The last question is still waiting for its answer. */
  waiting: boolean
} {
  const ordered = [...asides].sort((a, b) => a.createdAt - b.createdAt)
  const messages = ordered.flatMap((aside) =>
    aside.messages.map((message, index) => (index === 0 && aside.quote ? { ...message, quote: aside.quote } : message)),
  )
  const latest = ordered.at(-1)
  return {
    messages,
    continueId: latest?.id ?? null,
    waiting: latest?.messages.at(-1)?.role === 'user',
  }
}

/** A passage quoted into an ongoing side chat travels inside the question, as a Markdown quote above it. */
export function quotedQuestion(question: string, quote: string): string {
  const passage = quote.trim()
  if (!passage) return question
  return `${passage
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')}\n\n${question}`
}
