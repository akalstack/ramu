import { describe, expect, it } from 'vitest'
import type { LibrarySummary, LibrarySummaryItem, SummariesSnapshot } from '@ramu/shared/types'
import { activeSummaries, groupItems, nextSummaryAt, runMessage, unreadCount } from '../src/summaries/summaryLogic'

const summary = (id: string, status: LibrarySummary['status'], createdAt: number): LibrarySummary => ({
  id,
  periodStart: 0,
  periodEnd: createdAt,
  text: `Summary ${id}`,
  headline: `Headline ${id}`,
  items: [],
  changedByYou: '',
  status,
  chatIds: [],
  model: 'codex',
  createdAt,
})
const snapshot = (summaries: LibrarySummary[]): SummariesSnapshot => ({
  summaries,
  running: false,
  error: null,
  lastRunAt: null,
})
describe('summaries list', () => {
  it('hides dismissed summaries from the active list', () => {
    const all = [summary('c', 'dismissed', 3), summary('b', 'read', 2), summary('a', 'unread', 1)]
    expect(activeSummaries(all).map((entry) => entry.id)).toEqual(['b', 'a'])
  })
  it('counts unread summaries for the dot', () => {
    expect(unreadCount([summary('a', 'unread', 1), summary('b', 'read', 2), summary('c', 'unread', 3)])).toBe(2)
  })
})

describe('schedule text', () => {
  it('reports when the next summary is due', () => {
    expect(nextSummaryAt('off', 1000)).toBeNull()
    expect(nextSummaryAt('weekly', null)).toBeNull()
    expect(nextSummaryAt('daily', 1000)).toBe(1000 + 86_400_000)
    expect(nextSummaryAt('weekly', 1000)).toBe(1000 + 7 * 86_400_000)
  })
  it('explains the result of Run now', () => {
    const date = (at: number) => `day-${at}`
    expect(runMessage({ status: 'skipped', since: 5 }, date)).toBe('Nothing new since day-5')
    expect(runMessage({ status: 'busy' }, date)).toMatch(/busy/)
    expect(runMessage({ status: 'off' }, date)).toMatch(/on first/)
    expect(runMessage({ status: 'created', id: 'x' }, date)).toBeNull()
  })
})

describe('item groups', () => {
  it('orders groups by what happened and puts flagged items first', () => {
    const items: LibrarySummaryItem[] = [
      { kind: 'memory', id: '1', title: 'old', change: 'archived' },
      { kind: 'skill', id: '2', title: 'plain', change: 'added' },
      { kind: 'memory', id: '3', title: 'flagged', change: 'added', worthALook: true },
    ]
    const groups = groupItems(items)
    expect(groups.map((group) => group.change)).toEqual(['added', 'archived'])
    expect(groups[0]!.items.map((item) => item.title)).toEqual(['flagged', 'plain'])
  })
})
