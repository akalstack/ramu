import { describe, expect, it } from 'vitest'
import { formatChatDate, needsChatDate } from '../src/shared/chatDates'

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()

describe('conversation date separators', () => {
  it('shows the first known time without inventing dates for older events', () => {
    expect(needsChatDate(undefined, undefined)).toBe(false)
    expect(needsChatDate(at(10, 16, 38), undefined)).toBe(true)
    expect(needsChatDate(NaN, undefined)).toBe(false)
  })
  it('groups nearby replies and separates a resumed conversation', () => {
    expect(needsChatDate(at(10, 16, 40), at(10, 16, 38))).toBe(false)
    expect(needsChatDate(at(10, 17, 49), at(10, 16, 38))).toBe(true)
    expect(needsChatDate(at(10, 17, 8), at(10, 16, 38))).toBe(true)
  })
  it('separates calendar days even when only two minutes pass', () => {
    expect(needsChatDate(at(11, 0, 1), at(10, 23, 59))).toBe(true)
  })
  it('matches the reference time and handles relative and older dates', () => {
    const now = at(10, 18)
    expect(formatChatDate(at(10, 16, 38), now)).toBe('Today 4:38 PM')
    expect(formatChatDate(at(9, 17, 49), now)).toBe('Yesterday 5:49 PM')
    expect(formatChatDate(at(8, 9, 5), now)).toBe('Oct 8 9:05 AM')
    expect(formatChatDate(new Date(2025, 9, 8, 9, 5).getTime(), now)).toBe('Oct 8, 2025 9:05 AM')
    expect(formatChatDate(at(10, 16, 38), at(11, 0))).toBe('Yesterday 4:38 PM')
  })
})
