import type { AgentEvent, Attachment, FileContext, QueuedMessage } from '@ramu/shared/types'
import { visibleText } from './messages'

/** What a send carries to the host, kept so a failed one can go out again unchanged. */
export interface SubmissionPayload {
  outgoing: string
  mode: 'queue' | 'steer'
  context: FileContext[]
  /** Compact the conversation before this message, as the composer offered. */
  compactFirst: boolean
  /** Review comments that go out with it, by review. */
  reviews: { reviewId: string; ids: string[] }[]
}

/**
 * A message shown in the transcript the moment it is sent, before the host has it. It stays until the host echoes it
 * as a message or a queue entry, so it never blinks out between the send returning and the echo arriving. One that
 * failed stays, marked, so its text is never lost.
 */
export interface PendingSubmission {
  id: string
  text: string
  attachments: Attachment[]
  /** Transcript length and queue ids when it was sent: echoes are looked for only after these. */
  afterEvent: number
  queuedIds: string[]
  state: 'sending' | 'sent' | 'failed'
  error?: string
  payload: SubmissionPayload
}

/**
 * The sends still to show, oldest first. Each host echo stands for one send only, so two identical messages sent in a
 * row each wait for their own copy; an echo that predates a send never matches it. A send that failed here but reached
 * the host anyway (a timeout) is replaced by its echo too, so it is never retried twice.
 */
export function unechoedSubmissions(
  pending: readonly PendingSubmission[],
  events: readonly AgentEvent[],
  queue: readonly QueuedMessage[],
): PendingSubmission[] {
  const usedEvents = new Set<number>()
  const usedQueue = new Set<string>()
  return pending.filter((item) => {
    const matches = (text: string, attachments: Attachment[] = []) =>
      visibleText(text) === item.text &&
      attachments.length === item.attachments.length &&
      attachments.every((file, index) => file.id === item.attachments[index]?.id)
    for (let index = item.afterEvent; index < events.length; index++) {
      const event = events[index]!
      if (usedEvents.has(index) || event.kind !== 'user' || event.agentId || !matches(event.text, event.attachments))
        continue
      usedEvents.add(index)
      return false
    }
    const queued = queue.find(
      (message) =>
        !usedQueue.has(message.id) &&
        !item.queuedIds.includes(message.id) &&
        matches(message.text, message.attachments),
    )
    if (!queued) return true
    usedQueue.add(queued.id)
    return false
  })
}

/** Steers wait in the transcript after the latest tool call; only queued messages belong in the queue tray. */
export function splitSteering(queue: QueuedMessage[]): { tray: QueuedMessage[]; steering: QueuedMessage[] } {
  return {
    tray: queue.filter((message) => message.mode !== 'steer'),
    steering: queue.filter((message) => message.mode === 'steer'),
  }
}
