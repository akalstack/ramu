import { describe, expect, it } from 'vitest'
import { toBlocks } from '../src/views/agent/lib/blocks'
import type { AgentEvent } from '@ramu/shared/types'

describe('transcript blocks', () => {
  it('keeps the same error from each automatic try at a limit as one card', () => {
    const tryAgain = (n: number): AgentEvent[] => [
      { kind: 'error', message: 'Claude usage limit reached.', at: n } as AgentEvent,
      {
        kind: 'provider-wait',
        retryAt: 10_000,
        updatedAt: n,
        guessed: false,
        provider: 'claude-code',
      } as AgentEvent,
    ]
    const blocks = toBlocks([...tryAgain(1), ...tryAgain(2), ...tryAgain(3)])
    const errors = blocks.filter((block) => block.kind === 'event' && block.event.kind === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ repeats: 3 })
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

  it('shows the same error back to back once, with its count, and keeps different ones apart', () => {
    const events: AgentEvent[] = [
      { kind: 'user', text: 'hi', at: 1 },
      { kind: 'error', message: 'Overloaded', at: 2 },
      { kind: 'state', state: 'failed', at: 3 },
      { kind: 'error', message: 'Overloaded', at: 4 },
      { kind: 'error', message: 'Overloaded', at: 5 },
      { kind: 'error', message: 'Invalid key', at: 6 },
      { kind: 'text', text: 'Back again', at: 7 },
      { kind: 'error', message: 'Overloaded', at: 8 },
    ]
    const blocks = toBlocks(events)
    expect(
      blocks.map((block) =>
        block.kind === 'event' ? [block.event.kind, block.event.at, block.repeats ?? 1] : [block.kind],
      ),
    ).toEqual([
      ['user', 1, 1],
      // The first keeps its place, so the row on screen stays put while repeats arrive.
      ['error', 2, 3],
      ['error', 6, 1],
      ['text', 7, 1],
      ['error', 8, 1],
    ])
  })

  it('folds a thread resuming after restarts with nothing between them', () => {
    const blocks = toBlocks([
      { kind: 'recovery', state: 'resumed', at: 1 },
      { kind: 'recovery', state: 'resumed', at: 2 },
      { kind: 'user', text: 'hi', at: 3 },
      { kind: 'recovery', state: 'resumed', at: 4 },
    ])
    expect(blocks.map((block) => (block.kind === 'event' ? (block.repeats ?? 1) : 0))).toEqual([2, 1, 1])
  })
})
