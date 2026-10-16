import { expect, it } from 'vitest'
import {
  antigravityModelReadings,
  antigravityUsageReadings,
  cursorUsageReadings,
  readAntigravityUsage,
  readCursorUsage,
} from '../src/providers/providerUsage'

it('maps Cursor plan usage to monthly readings: overall, and the two allowances behind it', () => {
  const readings = cursorUsageReadings(
    {
      billingCycleEnd: '1793000000000',
      planUsage: { totalPercentUsed: 42.26, autoPercentUsed: 10, apiPercentUsed: 85 },
    },
    5,
  )
  expect(readings).toEqual([
    { provider: 'cursor', window: 'monthly', usedPercent: 42.3, status: 'ok', resetsAt: 1793000000000, updatedAt: 5 },
    {
      provider: 'cursor',
      window: 'monthly',
      scope: 'Cursor models',
      usedPercent: 10,
      status: 'ok',
      resetsAt: 1793000000000,
      updatedAt: 5,
    },
    {
      provider: 'cursor',
      window: 'monthly',
      scope: 'Other models',
      usedPercent: 85,
      status: 'warning',
      resetsAt: 1793000000000,
      updatedAt: 5,
    },
  ])
  expect(cursorUsageReadings({ planUsage: { totalPercentUsed: 120 } })[0]).toMatchObject({
    usedPercent: 100,
    status: 'limited',
  })
  expect(cursorUsageReadings({ planUsage: { autoPercentUsed: 30 } })).toHaveLength(1)
  expect(cursorUsageReadings({})).toEqual([])
})
it('maps Antigravity quota buckets to scoped windows and keeps the fullest bucket', () => {
  const readings = antigravityUsageReadings(
    {
      groups: [
        {
          buckets: [
            { bucketId: 'gemini-pro', window: '5h', remainingFraction: 0.75, resetTime: '2026-10-14T20:00:00Z' },
            { bucketId: 'gemini-flash', window: '5h', remainingFraction: 0.25 },
            { bucketId: 'gemini-pro', window: 'weekly', remainingFraction: 1 },
            { bucketId: '3p-claude', window: 'weekly', remainingFraction: 0 },
            { bucketId: 'gemini-off', window: 'weekly', remainingFraction: 0, disabled: true },
            { bucketId: 'other', window: '5h', remainingFraction: 0 },
          ],
        },
      ],
    },
    1,
  )
  expect(readings).toHaveLength(4)
  expect(readings.find((r) => r.scope === 'Gemini' && r.window === 'five_hour')).toMatchObject({ usedPercent: 75 })
  // Claude and GPT share one allowance, so it counts against both.
  for (const scope of ['Claude', 'GPT'])
    expect(readings.find((r) => r.scope === scope)).toMatchObject({
      window: 'weekly',
      usedPercent: 100,
      status: 'limited',
    })
})
it('falls back to per-model quotas for accounts without a quota summary', () => {
  const readings = antigravityModelReadings(
    {
      models: {
        'gemini-pro': { quotaInfo: { remainingFraction: 0.6, resetTime: '2026-10-14T20:00:00Z' } },
        'gemini-flash': {
          quotaInfo: { remainingFraction: 0.9 },
          weeklyQuotaInfo: { remainingFraction: 0.2, resetTime: '2026-10-20T00:00:00Z' },
        },
        'claude-sonnet': { modelProvider: 'MODEL_PROVIDER_ANTHROPIC', quotaInfo: { remainingFraction: 0 } },
        'gpt-oss': { quotaInfo: { remainingFraction: 1 } },
        mystery: { quotaInfo: { remainingFraction: 0 } },
      },
    },
    7,
  )
  const pick = (scope: string, window: string) => readings.find((r) => r.scope === scope && r.window === window)
  // No stated window: a plain quota, not an invented five-hour or weekly one. The fullest model per family wins.
  expect(pick('Gemini', 'quota')).toMatchObject({
    usedPercent: 40,
    status: 'ok',
    resetsAt: Date.parse('2026-10-14T20:00:00Z'),
  })
  expect(pick('Gemini', 'weekly')).toMatchObject({ usedPercent: 80, status: 'warning' })
  expect(pick('Claude', 'quota')).toMatchObject({ usedPercent: 100, status: 'limited' })
  expect(pick('GPT', 'quota')).toMatchObject({ usedPercent: 0 })
  expect(readings.some((r) => r.scope === undefined)).toBe(false)
  expect(antigravityModelReadings({})).toEqual([])
})
it('reads nothing without a stored login, and never sends a Cursor token to another host', async () => {
  expect(await readCursorUsage(false, { AGENT_CLI_CREDENTIAL_STORE: 'memory' })).toEqual([])
  expect(
    await readCursorUsage(false, { CURSOR_AUTH_TOKEN: 'secret', CURSOR_API_ENDPOINT: 'https://evil.example' }),
  ).toEqual([])
  expect(await readAntigravityUsage({ GEMINI_HOME: '/nonexistent' })).toEqual([])
})
