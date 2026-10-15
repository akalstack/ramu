import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

interface TextBlock {
  kind?: 'thinking'
  nativeMessageId: string
  index: number
  text: string
  messageId: string
  completed: boolean
}
interface Message {
  nativeMessageId: string
  parent: string | null
  blocks: Map<number, TextBlock>
  stopped: boolean
}

/** Keep interleaved main/helper streams separate. Text and provider-exposed thinking stay separate; tools wait for complete blocks. */
export class ClaudeTextStream {
  private readonly completed = new Map<string, string | null>()
  private readonly lanes = new Map<string, string>()
  private readonly messages = new Map<string, Message>()
  private key(parent: string | null, nativeId: string): string {
    return JSON.stringify([parent, nativeId])
  }

  partial(msg: Extract<SDKMessage, { type: 'stream_event' }>): TextBlock | undefined {
    const lane = msg.parent_tool_use_id ?? ''
    const event = msg.event
    if (event.type === 'message_start') {
      const key = this.key(msg.parent_tool_use_id, event.message.id)
      this.lanes.set(lane, key)
      this.messages.set(key, {
        nativeMessageId: event.message.id,
        parent: msg.parent_tool_use_id,
        blocks: new Map(),
        stopped: false,
      })
      return
    }
    const key = this.lanes.get(lane)
    const message = key ? this.messages.get(key) : undefined
    if (!message) return
    if (event.type === 'message_stop') {
      message.stopped = true
      if ([...message.blocks.values()].every((block) => block.completed)) this.messages.delete(key!)
      this.lanes.delete(lane)
      return
    }
    if (
      event.type === 'content_block_start' &&
      event.content_block.type === 'thinking' &&
      typeof event.content_block.thinking === 'string'
    ) {
      const block: TextBlock = {
        kind: 'thinking',
        nativeMessageId: message.nativeMessageId,
        index: event.index,
        text: event.content_block.thinking,
        messageId: `claude-stream:${key}:${event.index}`,
        completed: false,
      }
      message.blocks.set(event.index, block)
      return block.text.trim() ? { ...block } : undefined
    }
    if (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta') {
      const block = message.blocks.get(event.index)
      if (!block || block.kind !== 'thinking' || block.completed) return
      block.text += event.delta.thinking
      return block.text.trim() ? { ...block } : undefined
    }
    if (event.type === 'content_block_start' && event.content_block.type === 'text') {
      const block = {
        nativeMessageId: message.nativeMessageId,
        index: event.index,
        text: event.content_block.text,
        messageId: `claude-stream:${key}:${event.index}`,
        completed: false,
      }
      message.blocks.set(event.index, block)
      return block.text.trim() ? { ...block } : undefined
    }
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      const block = message.blocks.get(event.index)
      if (!block || block.kind || block.completed) return
      block.text += event.delta.text
      return block.text.trim() ? { ...block } : undefined
    }
  }

  /** The SDK can send one completed block per assistant frame, with the same native message ID. */
  complete(msg: Extract<SDKMessage, { type: 'assistant' }>): Map<number, string> {
    if (this.completed.has(msg.uuid)) return new Map()
    this.completed.set(msg.uuid, msg.parent_tool_use_id)
    const key = this.key(msg.parent_tool_use_id, msg.message.id)
    const message = this.messages.get(key)
    const replacements = new Map<number, string>()
    if (!message) return replacements
    for (const [index, content] of msg.message.content.entries()) {
      if (content.type !== 'text' && content.type !== 'thinking') continue
      const value = content.type === 'text' ? content.text : content.thinking
      const pending = [...message.blocks.values()].filter(
        (block) => !block.completed && (content.type === 'thinking' ? block.kind === 'thinking' : !block.kind),
      )
      const block =
        pending.find((block) => block.text === value) ?? pending.find((block) => block.index === index) ?? pending[0]
      if (!block) continue
      block.completed = true
      replacements.set(index, block.messageId)
    }
    if (message.stopped && [...message.blocks.values()].every((block) => block.completed)) this.messages.delete(key)
    return replacements
  }

  finishMainTurn(): void {
    this.lanes.delete('')
    for (const [key, message] of this.messages) if (message.parent === null) this.messages.delete(key)
    for (const [uuid, parent] of this.completed) if (parent === null) this.completed.delete(uuid)
  }
}
