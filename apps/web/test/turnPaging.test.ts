import { expect, it } from 'vitest'
import { turnsToKeep } from '../src/views/agent/lib/paging'

const at = (count: number, sessionId = 'a') => ({ sessionId, count })

it('keeps the drawn turns when new ones arrive while the reader is scrolled up', () => {
  expect(turnsToKeep(at(26), at(27), false)).toBe(1)
  expect(turnsToKeep(at(26), at(29), false)).toBe(3)
})

it('lets a reader at the bottom follow, so the oldest turn slides out', () => {
  expect(turnsToKeep(at(26), at(27), true)).toBe(0)
})

it('adds nothing when turns are removed or a different chat opens', () => {
  expect(turnsToKeep(at(26), at(25), false)).toBe(0)
  expect(turnsToKeep(at(5, 'a'), at(80, 'b'), false)).toBe(0)
})
