import { describe, expect, it } from 'vitest'
import { listEmptyState, matchesWords, pageOf, searchWords } from '../src/listView'

describe('list view', () => {
  it('matches every word in any order, ignoring case and extra spaces', () => {
    const words = searchWords('  Webhook  POLL ')
    expect(words).toEqual(['webhook', 'poll'])
    expect(matchesWords('Switch from polling to webhooks', words)).toBe(true)
    expect(matchesWords('Switch to webhooks', words)).toBe(false)
    expect(matchesWords('anything', searchWords('   '))).toBe(true)
  })
  it('pages by size and reports what Show more adds', () => {
    const items = Array.from({ length: 25 }, (_, i) => i)
    expect(pageOf(items, 10, 10)).toMatchObject({ remaining: 15, next: 10 })
    expect(pageOf(items, 30, 10)).toMatchObject({ remaining: 0, next: 0 })
    expect(pageOf(items, 20, 10).next).toBe(5)
  })
  it('tells an empty list from a filtered-out one', () => {
    expect(listEmptyState(0, 0)).toBe('none')
    expect(listEmptyState(4, 0)).toBe('filtered')
    expect(listEmptyState(4, 2)).toBe('ok')
  })
})
