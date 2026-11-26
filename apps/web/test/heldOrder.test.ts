import { expect, it } from 'vitest'
import { heldOrder } from '../src/lib/heldOrder'

const rows = (ids: string) => [...ids].map((id) => ({ id }))
const shown = (ids: string, held: string | null) => {
  const result = heldOrder(rows(ids), held === null ? null : [...held])
  return [result.items.map((item) => item.id).join(''), result.over]
}

it('shows the dropped order until the saved order catches up, and never a row that is gone', () => {
  expect(shown('abc', null)).toEqual(['abc', false])
  // Dropped: the new order shows while the host still reports the old one.
  expect(shown('abc', 'bac')).toEqual(['bac', false])
  // The host caught up, so the hold ends.
  expect(shown('bac', 'bac')).toEqual(['bac', true])
  // A row removed or added meanwhile ends the hold and shows the saved list.
  expect(shown('cb', 'abc')).toEqual(['cb', true])
  expect(shown('abcd', 'bac')).toEqual(['abcd', true])
})
