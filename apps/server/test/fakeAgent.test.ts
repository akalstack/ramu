import { expect, it } from 'vitest'
import type { Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { fakeQuery } from '../src/providers/fakeAgent'

/** Runs one turn through the fake agent and returns the text of its replies. */
async function replies(content: SDKUserMessage['message']['content']): Promise<string> {
  async function* prompt(): AsyncGenerator<SDKUserMessage> {
    yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content } } as SDKUserMessage
  }
  const query: Query = fakeQuery({ prompt: prompt(), options: { cwd: '/work' } } as Parameters<typeof fakeQuery>[0])
  const texts: string[] = []
  for await (const message of query as AsyncIterable<SDKMessage>) {
    if (message.type === 'assistant')
      for (const block of message.message.content) if (block.type === 'text') texts.push(block.text)
    if (message.type === 'result') break
  }
  return texts.join('\n')
}

it('runs the [rich] scenario for a message that carries an attachment', async () => {
  const text = await replies([
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    { type: 'text', text: '[rich] compare the endpoints' },
  ])
  expect(text).toContain('## Password reset: what changed')
  expect(text).toContain('| Endpoint |')
})

it('runs the same scenario for a plain text message', async () => {
  expect(await replies('[rich] compare the endpoints')).toContain('- [x] Single-use tokens')
})
