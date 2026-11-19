import { expect, it } from 'vitest'
import { isSshTarget } from '../src/hostTarget'

it('connects user@host and SSH config names over SSH', () => {
  expect(isSshTarget('me@build.example.com', [])).toBe(true)
  expect(isSshTarget(' studio ', ['studio'])).toBe(true)
})

it('pairs links and addresses with a code', () => {
  expect(isSshTarget('ramu://pair?u=http%3A%2F%2F10.0.0.2%3A7788&c=ABC', [])).toBe(false)
  expect(isSshTarget('http://192.168.1.20:7788', [])).toBe(false)
  expect(isSshTarget('100.64.0.7:7788', [])).toBe(false)
  expect(isSshTarget('studio', [])).toBe(false)
  expect(isSshTarget('', ['studio'])).toBe(false)
})
