import type { AgentEvent, AgentSessionState } from '../types'
import { requestOutcomes } from './questions'
import { resultStopped } from './turnResult'

/** How many next messages a turn offers: the best guess, shown in the empty composer, and two alternatives. */
export const NEXT_MESSAGE_MAX = 3
const MAX_LENGTH = 160

/**
 * Whether the thread is at a point where predicting the person's next message helps: the last turn finished cleanly and
 * nothing is waiting on them or already queued. `at` is the turn's position, so one prediction serves every device.
 */
export function nextMessagePoint(events: readonly AgentEvent[], state: AgentSessionState): { at: number } | null {
  if (state !== 'idle') return null
  const outcomes = requestOutcomes(events as AgentEvent[])
  let at = -1
  let queued = 0
  for (let index = 0; index < events.length; index++) {
    const event = events[index]!
    if (event.agentId) continue
    if (event.kind === 'queue') queued = event.messages.length
    // A question still open is what the person answers next; suggesting something else would talk past it.
    if (event.kind === 'question' && !outcomes.has(event.requestId)) return null
    if (event.kind === 'user') at = -1
    if (event.kind === 'result') at = resultStopped(event) ? -1 : index
    if (event.kind === 'error') at = -1
  }
  return at < 0 || queued > 0 ? null : { at }
}

/** What Ramu knows about the thread beyond the conversation, so a suggestion can name the real next step. */
export interface NextMessageFacts {
  goal?: string
  uncommittedFiles?: number
}

export function nextMessagePrompt(facts: NextMessageFacts, transcript?: string): string {
  const known = [
    facts.goal ? `The thread's goal: ${facts.goal}` : '',
    facts.uncommittedFiles ? `Uncommitted changes: ${facts.uncommittedFiles} file(s).` : '',
  ].filter(Boolean)
  return [
    `Predict what the person will most likely send next in this conversation, as they would type it: short, direct, in their language and voice, at most ${MAX_LENGTH} characters each. Give up to ${NEXT_MESSAGE_MAX}, the most likely first, each a different next step (not rewordings). Prefer the concrete step the work is ready for, such as running or testing what was built, fixing what failed, committing, or opening a pull request. Do not ask them questions, greet, thank, or repeat what they already said. If you asked them something or no next step is clear, give none.`,
    known.length ? `What is known about the thread:\n${known.join('\n')}` : '',
    transcript ? `The end of the conversation:\n${transcript}` : '',
    'Do not use tools. Reply with only JSON: {"suggestions": ["…"]}',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The suggestions in a model's reply: single lines, deduplicated and bounded; anything unreadable is none. */
export function parseNextMessages(reply: string): string[] {
  const json = /\{[\s\S]*\}/.exec(reply)?.[0]
  if (!json) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  const list = (parsed as { suggestions?: unknown } | null)?.suggestions
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const text = item.replace(/\s+/g, ' ').trim()
    if (!text || text.length > MAX_LENGTH || seen.has(text.toLowerCase())) continue
    seen.add(text.toLowerCase())
    out.push(text)
    if (out.length === NEXT_MESSAGE_MAX) break
  }
  return out
}
