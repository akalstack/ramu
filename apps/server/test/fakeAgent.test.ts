import { expect, it, vi } from 'vitest'
import type { Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { DEFAULT_AGENT_SETTINGS, type AgentEvent } from '@ramu/shared/types'
import { fakeCodex, fakeQuery } from '../src/providers/fakeAgent'

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

it('ends a fake turn whose tool call fails as a failed turn, keeping the host running', async () => {
  const events: AgentEvent[] = []
  const runner = fakeCodex(
    { cwd: '/work' } as Parameters<typeof fakeCodex>[0],
    { ...DEFAULT_AGENT_SETTINGS, provider: 'codex' },
    (event) => void events.push(event),
  )
  // Nothing listens here, so the tool call cannot reach Ramu's tools.
  runner.setTools?.({ url: 'http://127.0.0.1:9/mcp', token: 'test' })
  await runner.start('<tool-call>{"name":"speak","arguments":{"text":"Hello"}}</tool-call>', null)
  await vi.waitFor(() => expect(events.some((event) => event.kind === 'result')).toBe(true), { timeout: 10_000 })
  expect(events.find((event) => event.kind === 'result')).toMatchObject({ kind: 'result', isError: true })
})
