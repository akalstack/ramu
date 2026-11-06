import type { AgentEvent } from '@ramu/shared/types'
import { ramuTool } from '@ramu/shared/chat/ramuTools'

/**
 * Whether a helper gets its own copy of the checkout. It does when it would write at the same time as another writer
 * there: it runs in the background while the thread works on, or another writing helper is still running. A helper the
 * thread waits for alone shares the checkout, so its edits show in the thread's change review as they happen and it can
 * still be messaged. Read-only helpers and teammates (one writer at a time, always reachable) never need a copy.
 */
export function needsOwnCheckout(helper: {
  background: boolean
  readOnly: boolean
  teammate: boolean
  /** Writing helpers of the same thread that are still running. */
  otherWriters: number
  /** What the agent asked for; sharing still gives way when another writer would collide with it. */
  requested?: 'shared' | 'worktree'
}): boolean {
  if (helper.readOnly || helper.teammate) return false
  if (helper.requested === 'worktree') return true
  if (helper.requested === 'shared') return helper.otherWriters > 0
  return helper.background || helper.otherWriters > 0
}

/**
 * How many other writers a starting helper would share the checkout with: writing helpers already running, other
 * helper starts still being prepared, and the thread's other open `ramu_agent` calls in its current turn. A model that
 * starts two helpers in one step sends both calls before either reaches Ramu, so the open calls count the sibling even
 * when its start has not begun yet. The starting helper's own open call is not counted.
 */
export function otherWriters(input: { events: readonly AgentEvent[]; running: number; starting: number }): number {
  const turnStart = input.events.findLastIndex((event) => !event.agentId && event.kind === 'user') + 1
  const turn = input.events.slice(turnStart).filter((event) => !event.agentId)
  const finished = new Set(
    turn.flatMap((event) => (event.kind === 'tool-result' && !event.running ? [event.toolUseId] : [])),
  )
  const open = turn.filter(
    (event) => event.kind === 'tool-use' && !finished.has(event.toolUseId) && ramuTool(event)?.name === 'ramu_agent',
  ).length
  return Math.max(input.running + input.starting, open - 1)
}
