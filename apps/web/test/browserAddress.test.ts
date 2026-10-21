import { expect, it } from 'vitest'
import { addressFrom } from '../src/views/browserAddress'

it('keeps a full address, adds a scheme to a bare host, and treats localhost as a local development server', () => {
  expect(addressFrom('https://example.com/a')).toBe('https://example.com/a')
  expect(addressFrom('example.com')).toBe('https://example.com')
  expect(addressFrom(' localhost:3000/app ')).toBe('http://localhost:3000/app')
  expect(addressFrom('127.0.0.1:8080')).toBe('http://127.0.0.1:8080')
})

it('rejects empty text and text with spaces instead of guessing a search', () => {
  expect(addressFrom('')).toBeNull()
  expect(addressFrom('   ')).toBeNull()
  expect(addressFrom('how to fix this')).toBeNull()
})
