import { expect, it } from 'vitest'
import {
  IDLE_COMPACTION_LEAD_MS,
  idleAge,
  idleCompactionHeld,
  idleCompactionWindow,
  promptCacheTtlMs,
  resumeCompactionChoice,
  resumeCompactionQuestion,
  type IdleThread,
} from '../src/chat/idleCompaction'
import { compactionHeading } from '../src/chat/compaction'

it('reads the cache lifetime a response wrote, and none for a full cache read', () => {
  expect(promptCacheTtlMs({ ephemeral_1h_input_tokens: 10, ephemeral_5m_input_tokens: 0 })).toBe(3_600_000)
  expect(promptCacheTtlMs({ ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 3 })).toBe(300_000)
  expect(promptCacheTtlMs({ ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 })).toBeUndefined()
  expect(promptCacheTtlMs(null)).toBeUndefined()
})

it('opens the window two minutes before the last request’s cache expires, for large contexts only', () => {
  const request = { at: 1_000_000, ttlMs: 3_600_000, contextTokens: 250_000 }
  expect(idleCompactionWindow('beforeCacheExpires', request, 1_000_000)).toEqual({
    startMs: 1_000_000 + 3_600_000 - IDLE_COMPACTION_LEAD_MS,
    endMs: 4_600_000,
  })
  expect(idleCompactionWindow('beforeCacheExpires', { ...request, contextTokens: 199_999 }, 1_000_000)).toBeNull()
  expect(idleCompactionWindow('beforeCacheExpires', request, 4_600_000)).toBeNull()
  expect(idleCompactionWindow('beforeCacheExpires', undefined, 0)).toBeNull()
  expect(idleCompactionWindow('onReturn', request, 1_000_000)).toBeNull()
  expect(idleCompactionWindow('off', request, 1_000_000)).toBeNull()
})

it('holds back while the thread has anything that starts or ends a turn of its own', () => {
  const idle: IdleThread = {
    idle: true,
    pendingRequests: false,
    backgroundWork: false,
    queuedMessages: false,
    continuesOnItsOwn: false,
    done: false,
    justCompacted: false,
  }
  expect(idleCompactionHeld(idle)).toBe(false)
  for (const key of [
    'pendingRequests',
    'backgroundWork',
    'queuedMessages',
    'continuesOnItsOwn',
    'done',
    'justCompacted',
  ])
    expect(idleCompactionHeld({ ...idle, [key]: true })).toBe(true)
  expect(idleCompactionHeld({ ...idle, idle: false })).toBe(true)
})

it('words the return question from Claude’s payload and maps every answer safely', () => {
  expect(idleAge(45)).toBe('45m')
  expect(idleAge(125)).toBe('2h 5m')
  expect(idleAge(3 * 1440 + 250)).toBe('3d 4h')
  expect(idleAge(Number.NaN)).toBe('0m')
  const ask = resumeCompactionQuestion({ sessionAgeMinutes: 71.6, estimatedTokens: 123456.7 }, 'onReturn')
  expect(ask.question).toBe(
    'This thread was last active 1h 11m ago and holds about 123,456 tokens. Compact it before continuing?',
  )
  expect(ask.options.map((option) => option.label)).toEqual([
    'Compact and continue',
    'Keep full history',
    "Don't ask again",
  ])
  expect(resumeCompactionQuestion({}, 'beforeCacheExpires').options).toHaveLength(2)
  expect(resumeCompactionQuestion({ sessionAgeMinutes: 'x' }, 'onReturn').question).toContain('0m ago')
  expect(resumeCompactionChoice(' Compact and continue ')).toBe('compact')
  expect(resumeCompactionChoice("Don't ask again")).toBe('never')
  expect(resumeCompactionChoice('Keep full history')).toBe('continue')
  expect(resumeCompactionChoice('something else')).toBe('continue')
  expect(resumeCompactionChoice(undefined)).toBe('continue')
})

it('names compactions Ramu started apart from a manual or provider one', () => {
  expect(compactionHeading({ kind: 'compaction', state: 'completed', trigger: 'idle' })).toBe('Compacted while idle')
  expect(compactionHeading({ kind: 'compaction', state: 'completed', trigger: 'resume' })).toBe(
    'Compacted when you returned',
  )
  expect(compactionHeading({ kind: 'compaction', state: 'completed' })).toBe('Context compacted')
})
