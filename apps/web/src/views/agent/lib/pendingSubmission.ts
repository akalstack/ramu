import type { AgentEvent, Attachment, QueuedMessage } from '@ramu/shared/types'
import { visibleText } from './messages'

export interface PendingSubmission {
  text: string
  attachments: Attachment[]
  afterEvent: number
  queuedIds: string[]
}

/** Local feedback lasts only until the host echoes this send as a message or a durable queue entry. */
export function pendingSubmissionVisible(
  pending: PendingSubmission | null,
  events: AgentEvent[],
  queue: QueuedMessage[],
): pending is PendingSubmission {
  if (!pending) return false
  const matches = (text: string, attachments: Attachment[] = []) =>
    visibleText(text) === pending.text &&
    attachments.length === pending.attachments.length &&
    attachments.every((file, index) => file.id === pending.attachments[index]?.id)
  return !(
    events
      .slice(pending.afterEvent)
      .some((event) => event.kind === 'user' && !event.agentId && matches(event.text, event.attachments)) ||
    queue.some((message) => !pending.queuedIds.includes(message.id) && matches(message.text, message.attachments))
  )
}

/** How long a steer stays in the transcript as a sent message before it is shown as waiting in the queue. */
export const STEER_GRACE_MS = 1000

/**
 * Steering normally reaches the running turn within milliseconds; showing it in the queue for that moment makes the
 * tray flash. A steer first seen within the grace period reads as sent; one still waiting after it, on active tools,
 * moves to the queue where it can be edited or removed.
 */
export function splitSteering(
  queue: QueuedMessage[],
  seenAt: ReadonlyMap<string, number>,
  now: number,
  graceMs = STEER_GRACE_MS,
): { tray: QueuedMessage[]; steering: QueuedMessage[] } {
  const steering = queue.filter(
    (message) => message.mode === 'steer' && now - (seenAt.get(message.id) ?? now) < graceMs,
  )
  return { tray: steering.length ? queue.filter((message) => !steering.includes(message)) : queue, steering }
}
