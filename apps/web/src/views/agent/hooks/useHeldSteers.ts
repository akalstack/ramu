import { useEffect, useReducer, useRef } from 'react'
import type { AgentEvent, QueuedMessage } from '@ramu/shared/types'
import { visibleText } from '../lib/messages'

/** How long a steer the queue let go of stays drawn while its message is on the way into the transcript. */
const HANDOVER_MS = 400

/**
 * The steers to draw: the queue's, plus one the queue just let go of until its message shows in the transcript. The
 * host reports the queue and the transcript separately, so without this the steer vanished for a frame before its
 * message appeared, and the chat shrank and grew under the reader. `forget` drops one the person removed themselves.
 */
export function useHeldSteers(
  steering: QueuedMessage[],
  events: readonly AgentEvent[],
): { steers: QueuedMessage[]; forget(id: string): void } {
  const seen = useRef(new Map<string, { message: QueuedMessage; since: number }>())
  const leaving = useRef(new Map<string, { message: QueuedMessage; since: number; at: number }>())
  const [, redraw] = useReducer((count: number) => count + 1, 0)
  const now = performance.now()
  const queued = new Set(steering.map((message) => message.id))
  for (const message of steering) {
    const known = seen.current.get(message.id)
    seen.current.set(message.id, { message, since: known?.since ?? events.length })
    leaving.current.delete(message.id)
  }
  for (const [id, entry] of seen.current) {
    if (queued.has(id)) continue
    seen.current.delete(id)
    leaving.current.set(id, { ...entry, at: now })
  }
  for (const [id, entry] of leaving.current) {
    const text = visibleText(entry.message.text)
    const arrived = events
      .slice(entry.since)
      .some((event) => event.kind === 'user' && !event.agentId && visibleText(event.text) === text)
    if (arrived || now - entry.at >= HANDOVER_MS) leaving.current.delete(id)
  }
  const waiting = leaving.current.size
  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(redraw, HANDOVER_MS)
    return () => clearTimeout(timer)
  }, [waiting, steering, events])
  return {
    steers: [...steering, ...[...leaving.current.values()].map((entry) => entry.message)],
    forget: (id) => {
      seen.current.delete(id)
      leaving.current.delete(id)
    },
  }
}
