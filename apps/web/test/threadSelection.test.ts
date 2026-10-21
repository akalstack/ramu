import { beforeEach, expect, it } from 'vitest'
import { threadSelection } from '../src/sidebar/projects/threadSelection'

const order = ['a', 'b', 'c', 'd', 'e']
beforeEach(() => threadSelection.clear())

it('toggles single threads and clears them', () => {
  threadSelection.toggle('b')
  threadSelection.toggle('d')
  expect([...threadSelection.ids()]).toEqual(['b', 'd'])
  threadSelection.toggle('b')
  expect([...threadSelection.ids()]).toEqual(['d'])
  threadSelection.clear()
  expect(threadSelection.ids().size).toBe(0)
})

it('selects a range in list order from the last toggled thread, in either direction', () => {
  threadSelection.toggle('b')
  threadSelection.range('d', order)
  expect([...threadSelection.ids()].sort()).toEqual(['b', 'c', 'd'])
  threadSelection.clear()
  threadSelection.toggle('d')
  threadSelection.range('a', order)
  expect([...threadSelection.ids()].sort()).toEqual(['a', 'b', 'c', 'd'])
})

it('falls back to a single toggle when there is no anchor or the thread is not listed', () => {
  threadSelection.range('c', order)
  expect([...threadSelection.ids()]).toEqual(['c'])
  threadSelection.range('zzz', order)
  expect([...threadSelection.ids()].sort()).toEqual(['c', 'zzz'])
})
