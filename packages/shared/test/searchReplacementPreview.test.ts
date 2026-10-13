import { expect, it } from 'vitest'
import { searchReplacementPreview } from '../src/searchReplacementPreview'
import type { SearchMatch, SearchOptions } from '../src/types'
const options: SearchOptions = { query: 'cat-(\\d+)', regex: true, caseSensitive: true, wholeWord: false, include: '', exclude: '' }
const match: SearchMatch = { repoId: 'r', path: 'file', line: 1, column: 6, endColumn: 12, text: 'left cat-12 right', start: 5, end: 11 }
it('shows literal replacement text immediately, including dollar signs and deletion', () => {
  expect(searchReplacementPreview(match, { ...options, regex: false }, '$1')).toBe('$1')
  expect(searchReplacementPreview(match, { ...options, regex: false }, '')).toBe('')
})
it('expands capture groups and dollar escapes in live regex previews', () => {
  expect(searchReplacementPreview(match, options, 'dog-$1-$$')).toBe('dog-12-$')
})
it('avoids inventing capture values for truncated matches or missing context', () => {
  expect(searchReplacementPreview({ ...match, endColumn: 200 }, options, '$1')).toBeNull()
  expect(searchReplacementPreview(match, options, "$'")).toBeNull()
})
