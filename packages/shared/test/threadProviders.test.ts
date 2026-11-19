import { expect, it } from 'vitest'
import { providerStack, threadProviders } from '../src/chat/threadProviders'

it('lists one agent for a thread that never changed provider', () => {
  expect(threadProviders([{ provider: 'claude-code', at: 1 }], 'claude-code')).toEqual(['claude-code'])
})

it('orders earlier agents by when each last worked and puts the leading one last', () => {
  expect(
    threadProviders(
      [
        { provider: 'claude-code', at: 1 },
        { provider: 'codex', at: 5 },
        { provider: 'cursor', at: 3 },
        { provider: 'claude-code', at: 9 },
      ],
      'codex',
    ),
  ).toEqual(['cursor', 'claude-code', 'codex'])
})

it('keeps the leading agent even before it has a recorded use', () => {
  expect(threadProviders([{ provider: 'claude-code', at: 1 }], 'antigravity')).toEqual(['claude-code', 'antigravity'])
  expect(threadProviders([], null)).toEqual([])
})

it('keeps the leading agent and the latest two before it for a row', () => {
  expect(providerStack(['opencode', 'cursor', 'claude-code', 'codex'])).toEqual(['cursor', 'claude-code', 'codex'])
  expect(providerStack(['codex'])).toEqual(['codex'])
})
