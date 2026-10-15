import { describe, expect, it } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeTextStream } from '../src/claudeTextStream'
const partial = (parent: string | null, event: unknown) =>
  ({ type: 'stream_event', parent_tool_use_id: parent, event }) as unknown as Extract<
    SDKMessage,
    { type: 'stream_event' }
  >
const complete = (parent: string | null, uuid: string, text: string) =>
  ({
    type: 'assistant',
    parent_tool_use_id: parent,
    uuid,
    message: { id: 'native', content: [{ type: 'text', text }] },
  }) as unknown as Extract<SDKMessage, { type: 'assistant' }>
const start = (stream: ClaudeTextStream, parent: string | null) =>
  stream.partial(partial(parent, { type: 'message_start', message: { id: 'native' } }))
const block = (stream: ClaudeTextStream, parent: string | null, index: number, text: string) =>
  stream.partial(partial(parent, { type: 'content_block_start', index, content_block: { type: 'text', text } }))!

describe('Claude streaming blocks', () => {
  it('joins multiple separately completed blocks sharing a native message ID, including identical text', () => {
    const stream = new ClaudeTextStream()
    start(stream, null)
    const first = block(stream, null, 1, 'Same text'),
      second = block(stream, null, 3, 'Same text')
    expect(stream.complete(complete(null, 'first', 'Same text')).get(0)).toBe(first.messageId)
    expect(stream.complete(complete(null, 'first', 'Same text')).size).toBe(0)
    expect(stream.complete(complete(null, 'second', 'Same text')).get(0)).toBe(second.messageId)
  })
  it('keeps helper streams alive across main-turn completion and accepts authoritative final text', () => {
    const stream = new ClaudeTextStream()
    start(stream, 'spawn')
    start(stream, null)
    const helper = block(stream, 'spawn', 2, 'Draft helper text')
    block(stream, null, 0, 'Main text')
    stream.finishMainTurn()
    expect(stream.complete(complete('spawn', 'helper', 'Corrected helper text')).get(0)).toBe(helper.messageId)
    start(stream, null)
    expect(block(stream, null, 0, 'New turn').text).toBe('New turn')
  })
  it('ignores private thinking and incomplete tool JSON instead of turning either into chat text', () => {
    const stream = new ClaudeTextStream()
    start(stream, null)
    for (const [type, delta] of [
      ['thinking', { type: 'thinking_delta', thinking: 'Private' }],
      ['tool_use', { type: 'input_json_delta', partial_json: '{"file":' }],
    ] as const) {
      expect(
        stream.partial(partial(null, { type: 'content_block_start', index: 0, content_block: { type } })),
      ).toBeUndefined()
      expect(stream.partial(partial(null, { type: 'content_block_delta', index: 0, delta }))).toBeUndefined()
    }
  })
})

it('keeps exposed thinking in its own stream and replaces it with the completed block', () => {
  const stream = new ClaudeTextStream()
  start(stream, null)
  stream.partial(
    partial(null, { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
  )
  const thought = stream.partial(
    partial(null, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'Inspect the module.' },
    }),
  )!
  expect(thought).toMatchObject({ kind: 'thinking', text: 'Inspect the module.' })
  const frame = {
    type: 'assistant',
    parent_tool_use_id: null,
    uuid: 'thinking-done',
    message: {
      id: 'native',
      content: [{ type: 'thinking', thinking: 'Inspect the module.', signature: 'private signature' }],
    },
  } as unknown as Extract<SDKMessage, { type: 'assistant' }>
  expect(stream.complete(frame).get(0)).toBe(thought.messageId)
  expect(
    stream.partial(
      partial(null, {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'private signature' },
      }),
    ),
  ).toBeUndefined()
})
