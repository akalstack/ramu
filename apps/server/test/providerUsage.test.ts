import { expect, it } from 'vitest'
import {
  antigravityUsageReadings,
  cursorUsageReadings,
  readAntigravityUsage,
  readCursorUsage,
} from '../src/providers/providerUsage'

it('maps Cursor plan usage to a monthly reading with the billing reset', () => {
  expect(cursorUsageReadings({ billingCycleEnd: '1793000000000', planUsage: { totalPercentUsed: 42.26 } }, 5)).toEqual([
    { provider: 'cursor', window: 'monthly', usedPercent: 42.3, status: 'ok', resetsAt: 1793000000000, updatedAt: 5 },
  ])
  expect(cursorUsageReadings({ planUsage: { totalPercentUsed: 120 } })[0]).toMatchObject({
    usedPercent: 100,
    status: 'limited',
  })
  expect(cursorUsageReadings({ planUsage: { totalPercentUsed: 85 } })[0]!.status).toBe('warning')
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
  expect(readings).toHaveLength(3)
  expect(readings.find((r) => r.scope === 'Gemini' && r.window === 'five_hour')).toMatchObject({ usedPercent: 75 })
  expect(readings.find((r) => r.scope === 'Claude')).toMatchObject({
    window: 'weekly',
    usedPercent: 100,
    status: 'limited',
  })
})
it('reads nothing without a stored login, and never sends a Cursor token to another host', async () => {
  expect(await readCursorUsage(false, { AGENT_CLI_CREDENTIAL_STORE: 'memory' })).toEqual([])
  expect(
    await readCursorUsage(false, { CURSOR_AUTH_TOKEN: 'secret', CURSOR_API_ENDPOINT: 'https://evil.example' }),
  ).toEqual([])
  expect(await readAntigravityUsage({ GEMINI_HOME: '/nonexistent' })).toEqual([])
})
