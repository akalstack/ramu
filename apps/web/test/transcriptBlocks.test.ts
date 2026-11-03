import { describe, expect, it } from 'vitest'
import { toBlocks } from '../src/views/agent/lib/blocks'
import type { AgentEvent } from '@ramu/shared/types'

describe('transcript blocks', () => {
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
})
