import { expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../src/types'
import {
  compactBeforeSend,
  compactBeforeSendFrom,
  compactionCounts,
  compactionLabel,
  contextTokensShort,
  isCompacting,
  isTurnFooter,
  promptCacheTtlMs,
} from '../src/chat/compaction'

it('uses provider token counts only when available and valid', () => {
  expect(compactionLabel({ kind: 'compaction', state: 'completed', beforeTokens: 212000, afterTokens: 33700 })).toBe(
    'Compacted context 212K → 33.7K tokens',
  )
  expect(compactionLabel({ kind: 'compaction', state: 'completed', beforeTokens: 212000 })).toBe(
    'Compacted context · 212K tokens before',
  )
  expect(compactionLabel({ kind: 'compaction', state: 'completed' })).toBe('Compacted context')
  expect(compactionLabel({ kind: 'compaction', state: 'completed', beforeTokens: NaN, afterTokens: -1 })).toBe(
    'Compacted context',
  )
})
it('ends the live compaction status on completion, failure, interruption or provider change', () => {
  const started = { kind: 'compaction', state: 'started' } as const
  expect(isCompacting([started, { kind: 'text', text: 'working' }])).toBe(true)
  expect(isCompacting([started, { kind: 'compaction', state: 'completed' }])).toBe(false)
  expect(isCompacting([started, { kind: 'compaction', state: 'failed' }])).toBe(false)
  expect(isCompacting([started, { kind: 'result', text: 'interrupted', isError: false, costUsd: null }])).toBe(false)
  expect(isCompacting([started, { kind: 'error', message: 'connection lost' }])).toBe(false)
  expect(
    isCompacting([
      started,
      { kind: 'settings', settings: DEFAULT_AGENT_SETTINGS, reason: 'Changed provider', handoff: true },
    ]),
  ).toBe(false)
})

it('keeps a final answer visible when idle compaction follows its result', () => {
  expect(isTurnFooter({ kind: 'compaction', state: 'completed' })).toBe(true)
  expect(isTurnFooter({ kind: 'compaction', state: 'failed' })).toBe(true)
  expect(isTurnFooter({ kind: 'result', text: 'done', isError: false, costUsd: null })).toBe(true)
  expect(isTurnFooter({ kind: 'result', text: 'failed', isError: true, costUsd: null })).toBe(false)
  expect(isTurnFooter({ kind: 'text', text: 'Final answer' })).toBe(false)
})

it('shows exact counts, supports zero, and marks unavailable counts explicitly', () => {
  expect(
    compactionCounts({
      kind: 'compaction',
      state: 'completed',
      beforeTokens: 212000,
      afterTokens: 0,
      contextWindow: 258400,
    }),
  ).toEqual({ before: '212,000', after: '0', window: '258,400' })
  expect(compactionCounts({ kind: 'compaction', state: 'completed', beforeTokens: NaN, afterTokens: -1 })).toEqual({
    before: 'Not reported',
    after: 'Not reported',
    window: null,
  })
  expect(compactionLabel({ kind: 'compaction', state: 'completed', afterTokens: 33700 })).toBe(
    'Compacted context · 33.7K tokens after',
  )
})
it('does not let a sub-agent hide the main compaction status', () => {
  expect(
    isCompacting([
      { kind: 'compaction', state: 'started' },
      { kind: 'result', agentId: 'helper', isError: false, text: 'done', costUsd: null },
    ]),
  ).toBe(true)
})

it('ends compaction activity for cancellation and future provider statuses', () => {
  const started = { kind: 'compaction', state: 'started' } as const
  expect(isCompacting([started, { kind: 'compaction', state: 'cancelled' }])).toBe(false)
  expect(isCompacting([started, { kind: 'compaction', state: 'unknown', providerStatus: '_paused' }])).toBe(false)
  expect(compactionLabel({ kind: 'compaction', state: 'cancelled' })).toBe('Context compaction cancelled')
  expect(compactionLabel({ kind: 'compaction', state: 'unknown', providerStatus: '_paused' })).toBe(
    'Context compaction · _paused',
  )
})

const hour = 60 * 60_000
const context = (used: number, extra: { lastRequestAt?: number; cacheTtlMs?: number } = {}) => ({
  used,
  max: 1_000_000,
  percent: Math.round(used / 10_000),
  at: 10_000,
  ...extra,
})

it('offers to compact an idle Claude thread of 200K tokens or more once its prompt cache has expired', () => {
  const large = context(240_000, { lastRequestAt: 0, cacheTtlMs: hour })
  expect(compactBeforeSend({ provider: 'claude-code', idle: true, context: large, now: hour - 1 })).toBeNull()
  expect(compactBeforeSend({ provider: 'claude-code', idle: true, context: large, now: hour })).toBe(240_000)
  expect(compactBeforeSend({ provider: 'claude-code', idle: false, context: large, now: 2 * hour })).toBeNull()
  expect(compactBeforeSend({ provider: 'codex', idle: true, context: large, now: 2 * hour })).toBeNull()
  expect(
    compactBeforeSend({
      provider: 'claude-code',
      idle: true,
      context: context(199_999, { lastRequestAt: 0 }),
      now: 2 * hour,
    }),
  ).toBeNull()
  expect(compactBeforeSend({ provider: 'claude-code', idle: true, context: null, now: 2 * hour })).toBeNull()
})

it('uses the cache lifetime Claude reported, falling back to an hour from the context reading', () => {
  expect(compactBeforeSendFrom('claude-code', context(300_000, { lastRequestAt: 1_000, cacheTtlMs: 5 * 60_000 }))).toBe(
    301_000,
  )
  expect(compactBeforeSendFrom('claude-code', context(300_000))).toBe(10_000 + hour)
  expect(promptCacheTtlMs({ ephemeral_1h_input_tokens: 10, ephemeral_5m_input_tokens: 0 })).toBe(hour)
  expect(promptCacheTtlMs({ ephemeral_5m_input_tokens: 10 })).toBe(5 * 60_000)
  expect(promptCacheTtlMs({ ephemeral_1h_input_tokens: 0 })).toBeUndefined()
  expect(promptCacheTtlMs(null)).toBeUndefined()
})

it('shortens context sizes for the composer', () => {
  expect(contextTokensShort(240_400)).toBe('240K')
  expect(contextTokensShort(1_240_000)).toBe('1.2M')
  expect(contextTokensShort(NaN)).toBe('0K')
})
