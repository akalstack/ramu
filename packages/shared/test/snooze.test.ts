import { describe, expect, it } from 'vitest'
import { DEFAULT_SNOOZE_MS, MAX_SNOOZE_MS, SNOOZE_CHOICES, snoozeUntil } from '../src/snooze'

// 2026-10-14 is a Wednesday.
const wednesday = new Date(2026, 9, 14, 15, 30).getTime()

describe('snoozeUntil', () => {
  it('waits three hours', () => {
    expect(snoozeUntil('in-3-hours', wednesday)).toBe(wednesday + 3 * 3_600_000)
  })
  it('returns tomorrow at nine, also after midnight', () => {
    expect(new Date(snoozeUntil('tomorrow', wednesday))).toEqual(new Date(2026, 9, 15, 9))
    expect(new Date(snoozeUntil('tomorrow', new Date(2026, 9, 14, 0, 5).getTime()))).toEqual(new Date(2026, 9, 15, 9))
  })
  it('returns next Monday at nine, and a full week from a Monday', () => {
    expect(new Date(snoozeUntil('next-week', wednesday))).toEqual(new Date(2026, 9, 19, 9))
    const monday = new Date(2026, 9, 19, 8).getTime()
    expect(new Date(snoozeUntil('next-week', monday))).toEqual(new Date(2026, 9, 26, 9))
    const sunday = new Date(2026, 9, 18, 22).getTime()
    expect(new Date(snoozeUntil('next-week', sunday))).toEqual(new Date(2026, 9, 19, 9))
  })
  it('stays after now and inside the bounds the host accepts', () => {
    for (const choice of SNOOZE_CHOICES) {
      const at = snoozeUntil(choice, wednesday)
      expect(at).toBeGreaterThan(wednesday)
      expect(at - wednesday).toBeLessThanOrEqual(MAX_SNOOZE_MS)
    }
    expect(DEFAULT_SNOOZE_MS).toBeLessThan(MAX_SNOOZE_MS)
  })
})
