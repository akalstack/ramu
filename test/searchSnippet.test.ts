import { describe, expect, it } from 'vitest'
import { searchSnippet } from '../src/shared/searchSnippet'

const measure = (text: string) => Array.from(text).length

describe('search result snippets', () => {
  it('reveals a match after a long SVG prefix in a narrow row', () => {
    const prefix = '<svg xmlns="http://www.w3.org/2000/svg" '.repeat(4)
    const snippet = searchSnippet(prefix + 'viewBox="0 0 24 24">', prefix.length, prefix.length + 7, 24, measure)
    expect(snippet.before.startsWith('…')).toBe(true)
    expect(measure(snippet.before) + measure(snippet.hit)).toBeLessThanOrEqual(24)
    expect(snippet.hit).toBe('viewBox')
    expect(snippet.after).toBe('="0 0 24 24">')
  })
  it('keeps short leading context and trims indentation', () => {
    expect(searchSnippet('    const value = 1', 10, 15, 80, measure)).toEqual({ before: 'const ', hit: 'value', after: ' = 1' })
  })
  it('shows more context when the sidebar is widened', () => {
    const text = 'a'.repeat(60) + 'match'
    const narrow = searchSnippet(text, 60, 65, 20, measure)
    const wide = searchSnippet(text, 60, 65, 100, measure)
    expect(wide.before.length).toBeGreaterThan(narrow.before.length)
    expect(wide.hit).toBe(narrow.hit)
  })
  it('shows the start of oversized and zero-width regex matches', () => {
    expect(searchSnippet('prefixVeryLongMatch', 6, 19, 4, measure).before).toBe('…')
    expect(searchSnippet('prefix', 6, 6, 10, measure).hit).toBe(' ')
  })
  it('keeps Unicode context intact and marks previews already cropped by search', () => {
    const snippet = searchSnippet('😀😀😀match', 6, 11, 20, measure, true)
    expect(snippet.before).toBe('…😀😀😀')
    expect(snippet.hit).toBe('match')
  })
})
