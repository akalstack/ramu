import { describe, expect, it } from 'vitest'
import { toBlocks } from '../src/views/agent/lib/blocks'
import type { AgentEvent } from '@ramu/shared/types'

describe('transcript blocks', () => {
  it('keeps the same error from each automatic try at a limit as one card', () => {
    const tryAgain = (n: number): AgentEvent[] => [
      { kind: 'error', message: 'Claude usage limit reached.', at: n } as AgentEvent,
      { kind: 'result', isError: true } as AgentEvent,
    ]
    const blocks = toBlocks([...tryAgain(1), ...tryAgain(2), ...tryAgain(3)])
    const errors = blocks.filter((block) => block.kind === 'event' && block.event.kind === 'error')
    expect(errors).toHaveLength(1)
  })

  it('gives bookkeeping events no row, so repeated limit retries leave no blank space', () => {
    const wait = (updatedAt: number): AgentEvent => ({
      kind: 'provider-wait',
      retryAt: 2_000,
      updatedAt,
      guessed: false,
      provider: 'claude-code',
      accountId: 'default',
      at: updatedAt,
    })
    const events: AgentEvent[] = [
      { kind: 'user', text: 'hi', at: 1 },
      { kind: 'error', message: 'Claude usage limit reached.', at: 2 },
      wait(3),
      wait(4),
      { kind: 'queue', messages: [], paused: false, at: 5 },
      wait(6),
    ]
    expect(toBlocks(events).map((block) => (block.kind === 'event' ? block.event.kind : block.kind))).toEqual([
      'user',
      'error',
    ])
  })

  it('shows an ability call once, as its own row, even when the call was refused', () => {
    const events: AgentEvent[] = [
      { kind: 'tool-use', toolUseId: 'u', name: 'mcp__ramu__generate_image', summary: '{"prompt":"Hero"}', at: 1 },
      { kind: 'tool-result', toolUseId: 'u', isError: true, summary: '{"status":"refused"}', at: 2 },
      {
        kind: 'ability',
        call: {
          id: 'c',
          ability: 'image_generation',
          tool: 'generate_image',
          status: 'refused',
          refusal: 'unavailable',
          args: { prompt: 'Hero' },
          sent: { prompt: 'Hero', inputs: [] },
          summary: 'No signed-in provider here has image generation.',
        },
        at: 3,
      },
    ]
    expect(toBlocks(events).map((block) => (block.kind === 'event' ? block.event.kind : block.kind))).toEqual([
      'ability',
    ])
  })
})
