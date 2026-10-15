import type { AgentEvent } from '@ramu/shared/types'
import { type ChatBlock as Block } from '@ramu/shared/chatFolding'
import { type Turn } from '../types'

/** One user message and everything the agent did in answer to it. */
export function toTurns(blocks: Block[], events: AgentEvent[]): Turn[] {
  const turns: Turn[] = []
  blocks.forEach((block, index) => {
    if (block.kind === 'event' && block.event.kind === 'user') {
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
      turn.interrupted = block.event.isError || /interrupt|abort/i.test(block.event.text)
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
  for (const turn of turns) turn.endedAt ??= ends.get(turn.user?.kind === 'event' ? turn.user.event : null)
  return turns
}
