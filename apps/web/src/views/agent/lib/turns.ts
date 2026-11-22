import type { AgentEvent } from '@ramu/shared/types'
import { type ChatBlock as Block } from '@ramu/shared/chat/chatFolding'
import { resultStopped } from '@ramu/shared/chat/turnResult'
import { type Turn } from '../types'

/** The agent producing something: after a turn's result this is a new turn, such as a goal continuing on its own. */
const agentOutput = (block: Block) =>
  block.kind === 'tools' || ['thinking', 'text', 'content', 'agent'].includes(block.event.kind)

/** One user message and everything the agent did in answer to it. */
export function toTurns(blocks: Block[], events: AgentEvent[]): Turn[] {
  const turns: Turn[] = []
  blocks.forEach((block, index) => {
    if (block.kind === 'event' && block.event.kind === 'user') {
      turns.push({ key: index, user: block, items: [], ended: false, startedAt: block.event.at })
      return
    }
    let turn = turns.at(-1)
    if (!turn || (turn.ended && agentOutput(block))) {
      const at = block.kind === 'event' ? block.event.at : undefined
      turn = {
        key: turn ? index : -1,
        user: null,
        items: [],
        ended: false,
        ...(at !== undefined ? { startedAt: at } : {}),
      }
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
  })
  return turns
}
