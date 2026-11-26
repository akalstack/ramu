import type { AgentEvent } from '@ramu/shared/types'
import { type ChatBlock as Block } from '@ramu/shared/chat/chatFolding'
import { awaitedCommands, turnWorkEnd } from '@ramu/shared/chat/helperPresentation'
import { resultStopped } from '@ramu/shared/chat/turnResult'
import { blockAt } from './blocks'
import { type Turn } from '../types'

/** The agent producing something: after a turn's result this is a new turn, such as a goal continuing on its own. */
const agentOutput = (block: Block) =>
  block.kind === 'tools' || ['thinking', 'text', 'content', 'agent'].includes(block.event.kind)

/** A message steered into a running turn: it continues that turn rather than starting a new one. */
export const steerBlock = (block: Block) =>
  block.kind === 'event' && block.event.kind === 'user' && !!block.event.steered

/**
 * A message steered in while the agent was already writing its answer: no call followed it, so the answer was written
 * without it and the provider ran it as the next turn. Taken out of the turn it arrived in.
 */
function takeLateSteer(turn: Turn): Block | null {
  const at = turn.items.findLastIndex(steerBlock)
  if (at < 0) return null
  if (turn.items.slice(at + 1).some((block) => block.kind === 'tools' || block.event.kind === 'agent')) return null
  return turn.items.splice(at, 1)[0]!
}

/**
 * One user message and everything the agent did in answer to it. Messages steered in while it ran stay inside it, so
 * the turn keeps one start, one timer and one "Worked for". One that arrived too late for the turn heads the work the
 * agent then did for it, so it never reads as ignored by the answer above it.
 */
export function toTurns(blocks: Block[], events: AgentEvent[]): Turn[] {
  const turns: Turn[] = []
  blocks.forEach((block, index) => {
    if (block.kind === 'event' && block.event.kind === 'user' && !(block.event.steered && turns.length)) {
      turns.push({ key: index, user: block, items: [], ended: false, startedAt: block.event.at })
      return
    }
    let turn = turns.at(-1)
    if (!turn || (turn.ended && agentOutput(block))) {
      const late = turn ? takeLateSteer(turn) : null
      const at = late ? blockAt(late) : blockAt(block)
      turn = {
        key: turn ? index : -1,
        user: late,
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
  const starts = new Set(turns.map((turn) => (turn.user?.kind === 'event' ? turn.user.event : null)))
  for (const event of events) {
    if (event.agentId) continue
    if (event.kind === 'user' && (!event.steered || starts.has(event))) user = event
    if (
      event.kind === 'state' &&
      ['idle', 'failed', 'stopped'].includes(event.state) &&
      event.at !== undefined &&
      !ends.has(user)
    )
      ends.set(user, event.at)
  }
  // Background commands have no block of their own, so the ones the agent waited on are read from the events.
  const awaited = awaitedCommands(events)
  turns.forEach((turn, index) => {
    const key = turn.user?.kind === 'event' ? turn.user.event : null
    turn.endedAt ??= ends.get(key)
    // A message steered into a running turn starts the next turn before the agent reports a result; with no stop or
    // failure in between, the agent carried on rather than stopped.
    if (!turn.ended && index < turns.length - 1 && !ends.has(key)) turn.ended = true
    if (turn.endedAt !== undefined && turn.ended && !turn.interrupted)
      turn.endedAt = turnWorkEnd(
        turn.endedAt,
        [
          ...turn.items.flatMap((block) =>
            block.kind === 'event' && block.event.kind === 'agent' ? [block.event] : [],
          ),
          ...awaited,
        ],
        turns[index + 1]?.startedAt,
      )
  })
  return turns
}

/** A turn's items split at each steered message: the work before the first steer, then each steer and what followed. */
export function turnParts(items: Block[]): { steer: Block | null; items: Block[] }[] {
  const parts: { steer: Block | null; items: Block[] }[] = [{ steer: null, items: [] }]
  for (const block of items)
    if (steerBlock(block)) parts.push({ steer: block, items: [] })
    else parts.at(-1)!.items.push(block)
  return parts
}
