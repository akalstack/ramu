import { describe, expect, it } from 'vitest'
import { loginUsage, loginUsageLine } from '../src/providers/loginUsage'
import type { UsageReading } from '../src/types'

const now = Date.UTC(2026, 10, 4, 1, 0)
const reading = (overrides: Partial<UsageReading>): UsageReading => ({
  provider: 'claude-code',
  window: 'five_hour',
  usedPercent: 10,
  status: 'ok',
  updatedAt: now,
  ...overrides,
})

describe('login usage', () => {
  const readings = [
    reading({ usedPercent: 100, status: 'limited', resetsAt: now + 70 * 60_000 }),
    reading({ accountId: 'work', window: 'weekly', usedPercent: 58 }),
    reading({
      accountId: 'team',
      window: 'weekly',
      usedPercent: 100,
      status: 'limited',
      resetsAt: now + 3 * 86_400_000,
    }),
  ]

  it('reads each login from its own readings, the first login from readings without an account', () => {
    expect(loginUsage(readings, 'claude-code', 'default', 'opus', now)?.limited).toBe(true)
    expect(loginUsage(readings, 'claude-code', 'work', 'opus', now)).toMatchObject({ limited: false })
    expect(loginUsage(readings, 'claude-code', 'unknown', 'opus', now)).toBeNull()
  })

  it('says how much is used, or that the login is at its limit and when it resets', () => {
    expect(loginUsageLine(loginUsage(readings, 'claude-code', 'work', 'opus', now), 'en', now)).toBe(
      '58% of the weekly limit used',
    )
    expect(loginUsageLine(loginUsage(readings, 'claude-code', 'default', 'opus', now), 'en', now)).toMatch(
      /^Limit reached · resets \d/,
    )
    // A reset days away names the day, so a weekly limit is not mistaken for one that ends tonight.
    expect(loginUsageLine(loginUsage(readings, 'claude-code', 'team', 'opus', now), 'en', now)).toMatch(
      /^Limit reached · resets [A-Z][a-z]{2} /,
    )
    expect(loginUsageLine(null, 'en', now)).toBeUndefined()
  })
})
