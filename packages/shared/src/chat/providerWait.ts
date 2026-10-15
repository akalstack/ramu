import type { AgentEvent } from '../types'

/** Present while every provider is at its usage limit: Ramu keeps the chat, queues new messages and retries on its own. */
export function providerWaitOf(events: readonly AgentEvent[]): { retryAt: number } | null {
  const last = events.findLast((event) => event.kind === 'provider-wait')
  return last?.kind === 'provider-wait' && last.retryAt !== null ? { retryAt: last.retryAt } : null
}
