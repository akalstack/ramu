import { expect, it } from 'vitest'
import type { UsageReading } from '../src/types'
import {
  groupUsageByProvider,
  relevantUsage,
  summaryUsage,
  usagePercent,
  usageStale,
  usageTone,
  usageWindow,
  usageScopeHint,
} from '../src/usage/presentation'
const reading = (overrides: Partial<UsageReading> = {}): UsageReading => ({
  provider: 'claude-code',
  window: 'five_hour',
  usedPercent: 42,
  status: 'ok',
  updatedAt: 1000,
  ...overrides,
})
it('keeps notice holds, invalid data and measured percentages distinct', () => {
  expect(usagePercent(reading({ source: 'notice', usedPercent: 100 }))).toBeNull()
  expect(usagePercent(reading({ usedPercent: NaN }))).toBeNull()
  expect(usagePercent(reading({ usedPercent: 200 }))).toBe(100)
  expect(usagePercent(reading({ usedPercent: -10 }))).toBe(0)
  expect(usageTone(reading({ usedPercent: 70 }))).toBe('warn')
  expect(usageTone(reading({ usedPercent: 90 }))).toBe('bad')
})
it('never substitutes another account and leaves ambiguous accounts unselected', () => {
  const rows = [reading({ accountId: 'a', usedPercent: 10 }), reading({ accountId: 'b', usedPercent: 99 })]
  expect(relevantUsage(rows, { provider: 'claude-code' })).toBeUndefined()
  expect(relevantUsage(rows, { provider: 'claude-code', accountId: 'a' })?.usedPercent).toBe(10)
  expect(relevantUsage(rows, { provider: 'claude-code', accountId: 'missing' })).toBeUndefined()
})
it('selects relevant bottlenecks without mixing model scopes', () => {
  const rows = [reading(), reading({ window: 'weekly', scope: 'opus', usedPercent: 95 })]
  expect(relevantUsage(rows, { provider: 'claude-code', model: 'opus' })?.usedPercent).toBe(95)
  expect(relevantUsage(rows, { provider: 'claude-code', model: 'sonnet' })?.usedPercent).toBe(42)
  expect(usageWindow(reading({ window: 'monthly' }))).toBe('Monthly')
  expect(usageWindow(reading({ window: 'quota' }))).toBe('Quota')
  expect(usageWindow(reading({ window: 'weekly', scope: 'opus' }))).toBe('opus · Weekly')
})
it('keeps past resets stale, and ranks fresh online hosts before offline or stale data', () => {
  expect(usageStale(reading({ resetsAt: 2000 }), 2001)).toBe(true)
  const hosts = [
    { id: 'offline', online: false, readings: [reading({ usedPercent: 100 })] },
    { id: 'live', online: true, readings: [reading({ usedPercent: 20 })] },
  ]
  expect(summaryUsage(hosts, 2000)).toMatchObject({ hostId: 'live', lastKnown: false })
  expect(summaryUsage([], 2000)).toBeUndefined()
  expect(
    summaryUsage(
      [
        { id: 'a', online: true, readings: [reading({ usedPercent: 30 })] },
        { id: 'b', online: true, readings: [reading({ usedPercent: 30 })] },
      ],
      2000,
    )?.hostId,
  ).toBe('a')
})

it('uses the routing model-scope rules for versioned model IDs while rejecting arbitrary substring matches', () => {
  const rows = [reading({ usedPercent: 10 }), reading({ scope: 'Opus', usedPercent: 95 })]
  expect(relevantUsage(rows, { provider: 'claude-code', model: 'claude-opus-4-7' })?.usedPercent).toBe(95)
  expect(
    relevantUsage([reading({ scope: 'Sonnet', usedPercent: 91 })], {
      provider: 'claude-code',
      model: 'claude-3-7-sonnet',
    })?.usedPercent,
  ).toBe(91)
  expect(relevantUsage(rows, { provider: 'claude-code', model: 'opus[1m]' })?.usedPercent).toBe(95)
  expect(relevantUsage(rows, { provider: 'claude-code', model: 'my-opus-proxy' })?.usedPercent).toBe(10)
  const other = [reading({ provider: 'codex', scope: 'gpt', usedPercent: 99 })]
  expect(relevantUsage(other, { provider: 'codex', model: 'gpt-6.1' })).toBeUndefined()
  expect(relevantUsage(other, { provider: 'codex', model: 'gpt' })?.usedPercent).toBe(99)
  expect(
    relevantUsage([reading({ provider: 'antigravity', scope: 'Gemini' })], {
      provider: 'antigravity',
      model: 'gemini-3-pro',
    })?.usedPercent,
  ).toBe(42)
})

it('localizes allowance windows without translating provider model identities', () => {
  expect(usageWindow(reading(), false, 'id')).toBe('5 jam')
  expect(usageWindow(reading({ window: 'weekly', scope: 'Opus' }), false, 'id')).toBe('Opus · Mingguan')
  expect(usageWindow(reading({ window: 'monthly' }), true, 'id')).toBe('bln')
  expect(usageWindow(reading({ window: 'quota' }), false, 'id')).toBe('Kuota')
  expect(usageWindow(reading({ provider: 'cursor', window: 'monthly' }), false, 'id')).toBe('Keseluruhan')
})

it('explains reported provider pools consistently and keeps unknown scopes unexplained', () => {
  const overall = reading({ provider: 'cursor', window: 'monthly' })
  expect(usageScopeHint(overall)).toBe('Combined usage across both allowances, not a third quota.')
  expect(usageScopeHint(overall, 'id')).toBe('Pemakaian gabungan dari kedua jatah, bukan kuota ketiga.')
  expect(usageScopeHint(reading({ provider: 'cursor', scope: 'Cursor models' }))).toContain('Auto')
  expect(usageScopeHint(reading({ provider: 'cursor', scope: 'Other models' }), 'id')).toContain(
    'Claude, GPT, dan Gemini',
  )
  for (const scope of ['Claude', 'GPT']) {
    expect(usageScopeHint(reading({ provider: 'antigravity', scope }))).toBe('Claude and GPT share one allowance.')
    expect(usageScopeHint(reading({ provider: 'antigravity', scope }), 'id')).toBe('Claude dan GPT berbagi satu jatah.')
  }
  expect(usageScopeHint(reading({ provider: 'cursor', window: 'quota' }))).toBeUndefined()
  expect(usageScopeHint(reading({ provider: 'cursor', scope: 'Future pool' }))).toBeUndefined()
  expect(usageScopeHint(reading({ provider: 'codex', scope: 'GPT' }))).toBeUndefined()
})

it('groups readings by provider and counts limited or high windows', () => {
  const groups = groupUsageByProvider([
    reading({ window: 'five_hour', usedPercent: 10 }),
    reading({ provider: 'codex', usedPercent: 90 }),
    reading({ window: 'weekly', status: 'limited', usedPercent: 100 }),
    reading({ provider: 'codex', source: 'notice', usedPercent: 100 }),
  ])
  expect(groups.map((g) => [g.provider, g.readings.length, g.attention])).toEqual([
    ['claude-code', 2, 1],
    ['codex', 2, 1],
  ])
  expect(groupUsageByProvider([])).toEqual([])
})
