import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent, Attachment, MessageOrigin, QueuedMessage } from '@ramu/shared/types'
import { attachmentPrompt, nativeBlocks } from '../attachments'

/** Merges messages steered into a running turn within the same moment into one request. */
export function combineQueued(messages: QueuedMessage[]): {
  text: string
  attachments: Attachment[]
  reviewId?: string
} {
  const attachments: Attachment[] = []
  for (const file of messages.flatMap((message) => message.attachments ?? []))
    if (!attachments.some((entry) => entry.id === file.id)) attachments.push(file)
  const reviewId = messages.find((message) => message.reviewId)?.reviewId
  return {
    text: messages
      .map((message) => message.text)
      .filter((text) => text.trim())
      .join('\n\n'),
    attachments,
    ...(reviewId ? { reviewId } : {}),
  }
}

/** The transcript entry for a message going to the agent, naming the thread that sent it when the person did not. */
export function userEvent(text: string, attachments: Attachment[], from?: MessageOrigin): AgentEvent {
  return { kind: 'user', text, ...(attachments.length ? { attachments } : {}), ...(from ? { from } : {}) }
}

/** Push-based async iterable used as the SDK's streaming input. */
export class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = []
  private waiter: ((r: IteratorResult<SDKUserMessage>) => void) | null = null
  private closed = false

  push(text: string, attachments: Attachment[] = []): void {
    const content: SDKUserMessage['message']['content'] = attachments.length
      ? [{ type: 'text', text: attachmentPrompt(text, attachments) }, ...nativeBlocks(attachments)]
      : text
    const msg: SDKUserMessage = { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }
    if (this.waiter) {
      const w = this.waiter
      this.waiter = null
      w({ value: msg, done: false })
    } else this.items.push(msg)
  }

  close(): void {
    this.closed = true
    this.waiter?.({ value: undefined, done: true })
    this.waiter = null
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift()
        if (item) return Promise.resolve({ value: item, done: false })
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => (this.waiter = resolve))
      },
    }
  }
}
