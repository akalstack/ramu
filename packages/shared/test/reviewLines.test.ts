import { expect, it } from 'vitest'
import { afterLineForBefore } from '../src/review/reviewLines'

it('keeps before-side comments visible after insertions, replacements, and deletions in inline view', () => {
  const insert = [
    { originalStartLineNumber: 2, originalEndLineNumber: 0, modifiedStartLineNumber: 3, modifiedEndLineNumber: 4 },
  ]
  expect(afterLineForBefore(2, insert)).toBe(2)
  expect(afterLineForBefore(3, insert)).toBe(5)
  const replace = [
    { originalStartLineNumber: 2, originalEndLineNumber: 4, modifiedStartLineNumber: 2, modifiedEndLineNumber: 3 },
  ]
  expect(afterLineForBefore(3, replace)).toBe(3)
  expect(afterLineForBefore(5, replace)).toBe(4)
  const deletion = [
    { originalStartLineNumber: 1, originalEndLineNumber: 3, modifiedStartLineNumber: 0, modifiedEndLineNumber: 0 },
  ]
  expect(afterLineForBefore(2, deletion)).toBe(0)
  expect(afterLineForBefore(4, deletion)).toBe(1)
})
