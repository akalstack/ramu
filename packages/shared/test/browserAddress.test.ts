import { expect, it } from 'vitest'
import { addressFrom, searchTemplateFrom } from '../src/browserLinks'

const search = 'https://duckduckgo.com/?q=%s'

it('keeps a full address, adds a scheme to a bare host, and treats localhost as a local development server', () => {
  expect(addressFrom('https://example.com/a')).toBe('https://example.com/a')
  expect(addressFrom('example.com')).toBe('https://example.com')
  expect(addressFrom('example.com/a?b=1', search)).toBe('https://example.com/a?b=1')
  expect(addressFrom(' localhost:3000/app ')).toBe('http://localhost:3000/app')
  expect(addressFrom('127.0.0.1:8080')).toBe('http://127.0.0.1:8080')
})

it('searches for anything that is not an address, only when a search is configured', () => {
  expect(addressFrom('')).toBeNull()
  expect(addressFrom('   ')).toBeNull()
  expect(addressFrom('how to fix this')).toBeNull()
  expect(addressFrom('how to fix this', search)).toBe('https://duckduckgo.com/?q=how%20to%20fix%20this')
  expect(addressFrom('anime', search)).toBe('https://duckduckgo.com/?q=anime')
  expect(addressFrom('what is a.b c&d', search)).toBe('https://duckduckgo.com/?q=what%20is%20a.b%20c%26d')
})

it('defaults to DuckDuckGo and accepts a custom address only when it has a place for the words', () => {
  expect(searchTemplateFrom(null, null)).toBe(search)
  expect(searchTemplateFrom('google', null)).toContain('google.com')
  expect(searchTemplateFrom('custom', 'https://kagi.com/search?q=%s')).toBe('https://kagi.com/search?q=%s')
  expect(searchTemplateFrom('custom', 'https://kagi.com/search')).toBe(search)
  expect(searchTemplateFrom('custom', 'javascript:%s')).toBe(search)
})
