import { expect, it } from 'vitest'
import { pageTurnDate, turnDatesOf } from '../src/views/agent/lib/derive'
import type { Turn } from '../src/views/agent/types'

const DAY = 24 * 60 * 60 * 1000
const turn = (key: number, startedAt: number): Turn => ({ key, user: null, items: [], ended: true, startedAt })

it('marks a turn that starts a new day and none that follow closely', () => {
  const start = new Date(2026, 0, 10, 9, 0).getTime()
  const turns = [turn(0, start), turn(1, start + 60_000), turn(2, start + DAY)]
  expect(turnDatesOf(turns)).toEqual([start, undefined, start + DAY])
})

it('reads the date of the drawn turn, not of the turn at the same position in the whole chat', () => {
  const start = new Date(2026, 0, 10, 9, 0).getTime()
  const turns = [turn(0, start), turn(1, start + DAY), turn(2, start + DAY + 60_000), turn(3, start + 2 * DAY)]
  const dates = turnDatesOf(turns)
  const hidden = 2
  const page = turns.slice(hidden)
  expect(page.map((_, ti) => pageTurnDate(dates, hidden, ti))).toEqual([undefined, start + 2 * DAY])
  // The page index alone would hand the first drawn turn the first turn's date.
  expect(dates[0]).toBe(start)
})

it('reads the same dates when nothing is hidden', () => {
  const start = new Date(2026, 0, 10, 9, 0).getTime()
  const dates = turnDatesOf([turn(0, start), turn(1, start + DAY)])
  expect([0, 1].map((ti) => pageTurnDate(dates, 0, ti))).toEqual(dates)
})
