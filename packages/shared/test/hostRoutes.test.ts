import { expect, it } from 'vitest'
import { learnedRoutes, MAX_LEARNED_ROUTES } from '../src/hostProof'

it('keeps a mesh route even when VM interfaces exhaust the route budget', () => {
  const bridges = Array.from({ length: 12 }, (_, i) => `http://192.168.${i}.1:7788`)
  const result = learnedRoutes([...bridges, 'http://100.99.224.30:7788'])
  expect(result).toHaveLength(MAX_LEARNED_ROUTES)
  expect(result[0]).toBe('http://100.99.224.30:7788')
  expect(result).toContain(bridges[0])
})

it('stores only canonical HTTP origins without credentials, paths, queries or fragments', () => {
  expect(
    learnedRoutes([
      'https://HOST:443/',
      'https://host',
      'http://user:secret@host',
      'http://host/path',
      'https://host?token=x',
      'ftp://host',
      'http://[fd00::1]:7788',
      null,
    ]),
  ).toEqual(['https://host', 'http://[fd00::1]:7788'])
})
