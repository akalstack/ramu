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
