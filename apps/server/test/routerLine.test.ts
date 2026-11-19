import { expect, it } from 'vitest'
import { cleanTitle, stripRouterLine } from '../src/agent'

it('drops a router banner line before the real answer', () => {
  expect(stripRouterLine('`auto → flash · low`\n\nExplain Lion Parcel repos')).toBe('Explain Lion Parcel repos')
  expect(cleanTitle('`auto → flash · low`\n\nExplain Lion Parcel repos')).toBe('Explain Lion Parcel repos')
})

it('keeps code fences, a lone code span and ordinary text', () => {
  expect(stripRouterLine('```\nfeat: x\n```')).toBe('```\nfeat: x\n```')
  expect(stripRouterLine('`npm test`')).toBe('`npm test`')
  expect(stripRouterLine('fix: use `foo`\n\nbody')).toBe('fix: use `foo`\n\nbody')
  expect(cleanTitle('Fix login bug')).toBe('Fix login bug')
})
