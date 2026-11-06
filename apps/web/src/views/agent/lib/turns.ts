import type { AgentEvent } from '@ramu/shared/types'
import { type ChatBlock as Block } from '@ramu/shared/chat/chatFolding'
import { resultStopped } from '@ramu/shared/chat/turnResult'
import { type Turn } from '../types'

/** A message the person wrote to a teammate opens a turn of its own, as their message to the lead does. */
const opensTurn = (event: AgentEvent) => event.kind === 'user' || event.kind === 'teammate-message'

/** A teammate's card is its work, not the lead's. */
const leadWork = (block: Block) => !(block.kind === 'event' && block.event.kind === 'agent' && block.event.teammate)

/**
 * One user message and everything the agent did in answer to it. A message to a teammate also starts a turn, so it
 * reads where it was written: the lead's earlier work and answer close above it, and any later work opens below.
 */
export function toTurns(blocks: Block[], events: AgentEvent[]): Turn[] {
  const turns: Turn[] = []
  blocks.forEach((block, index) => {
    if (block.kind === 'event' && opensTurn(block.event)) {
      turns.push({ key: index, user: block, items: [], ended: false, startedAt: block.event.at })
      return
    }
    let turn = turns.at(-1)
    if (!turn) {
      turn = { key: -1, user: null, items: [], ended: false }
      turns.push(turn)
    }
    turn.items.push(block)
    if (block.kind === 'event' && block.event.kind === 'result') {
      turn.ended = true
      turn.interrupted = resultStopped(block.event)
      turn.endedAt = block.event.at
    }
  })
  // Terminal states also end turns without a provider result (interrupts and failures).
  const ends = new Map<AgentEvent | null, number>()
  let user: AgentEvent | null = null
  for (const event of events) {
    if (event.agentId) continue
    if (event.kind === 'user') user = event
    if (
      event.kind === 'state' &&
      ['idle', 'failed', 'stopped'].includes(event.state) &&
      event.at !== undefined &&
      !ends.has(user)
    )
      ends.set(user, event.at)
  }
  turns.forEach((turn, index) => {
    const key = turn.user?.kind === 'event' ? turn.user.event : null
    turn.endedAt ??= ends.get(key)
    // A message steered into a running turn starts the next turn before the agent reports a result; with no stop or
    // failure in between, the agent carried on rather than stopped.
    if (!turn.ended && index < turns.length - 1 && !ends.has(key)) turn.ended = true
    // Nothing for the lead to finish: the teammate answers with a report of its own.
    if (key?.kind === 'teammate-message' && !turn.items.some(leadWork)) turn.ended = true
  })
  return turns
}
