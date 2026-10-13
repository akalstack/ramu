import { expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../src/types'
import { compactionLabel, isCompacting, isTurnFooter } from '../src/compaction'

it('uses provider token counts only when available and valid', () => {
  expect(compactionLabel({ kind: 'compaction', state: 'completed', beforeTokens: 212000, afterTokens: 33700 })).toBe('Compacted context 212K → 33.7K tokens')
  expect(compactionLabel({ kind: 'compaction', state: 'completed', beforeTokens: 212000 })).toBe('Compacted context · 212K tokens before')
  expect(compactionLabel({ kind: 'compaction', state: 'completed' })).toBe('Compacted context')
  expect(compactionLabel({ kind: 'compaction', state: 'completed', beforeTokens: NaN, afterTokens: -1 })).toBe('Compacted context')
})
it('ends the live compaction status on completion, failure, interruption or provider change', () => {
  const started = { kind: 'compaction', state: 'started' } as const
  expect(isCompacting([started, { kind: 'text', text: 'working' }])).toBe(true)
  expect(isCompacting([started, { kind: 'compaction', state: 'completed' }])).toBe(false)
  expect(isCompacting([started, { kind: 'compaction', state: 'failed' }])).toBe(false)
  expect(isCompacting([started, { kind: 'result', text: 'interrupted', isError: false, costUsd: null }])).toBe(false)
  expect(isCompacting([started, { kind: 'error', message: 'connection lost' }])).toBe(false)
  expect(isCompacting([started, { kind: 'settings', settings: DEFAULT_AGENT_SETTINGS, reason: 'Changed provider', handoff: true }])).toBe(false)
})

it('keeps a final answer visible when idle compaction follows its result', () => {
  expect(isTurnFooter({ kind: 'compaction', state: 'completed' })).toBe(true)
  expect(isTurnFooter({ kind: 'compaction', state: 'failed' })).toBe(true)
  expect(isTurnFooter({ kind: 'result', text: 'done', isError: false, costUsd: null })).toBe(true)
  expect(isTurnFooter({ kind: 'result', text: 'failed', isError: true, costUsd: null })).toBe(false)
  expect(isTurnFooter({ kind: 'text', text: 'Final answer' })).toBe(false)
})
