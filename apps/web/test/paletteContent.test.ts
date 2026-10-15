import { expect, it, vi } from 'vitest'
import { contentResult, contentSource } from '../src/palette/contentSource'

const match = (patch: Partial<Parameters<typeof contentResult>[0]> = {}) => ({
  repoId: 'r',
  path: 'src/a.ts',
  line: 3,
  column: 5,
  endColumn: 8,
  text: 'let foo = 1\n',
  start: 4,
  end: 7,
  ...patch,
})

it('splits the line around the hit and drops the line break', () => {
  const row = contentResult(match(), () => undefined)
  expect(row.snippet).toEqual({ before: 'let ', hit: 'foo', after: ' = 1' })
  expect(row.detail).toBe('src/a.ts:3')
})

it('crops a huge line instead of measuring all of it', () => {
  const text = `${'x'.repeat(100_000)}needle${'y'.repeat(100_000)}`
  const row = contentResult(match({ text, start: 100_000, end: 100_006 }), () => undefined)
  expect(row.snippet!.hit).toBe('needle')
  expect(row.snippet!.before.startsWith('…')).toBe(true)
  expect(row.snippet!.after.length).toBe(200)
})

it('searches literally through files.search, caps and flags the results', async () => {
  const search = vi.fn(async () => ({
    matches: [match({ line: 1 }), match({ line: 2 }), match({ line: 3 })],
    limited: false,
  }))
  const source = contentSource({ taskId: 't', search, open: () => undefined, limit: 2 })
  const out = await source.query('foo', { signal: new AbortController().signal, limit: 2, mode: 'all' })
  expect(search).toHaveBeenCalledWith(
    't',
    expect.objectContaining({ query: 'foo', regex: false, caseSensitive: false }),
  )
  expect('results' in out && out.results).toHaveLength(2)
  expect('limited' in out && out.limited).toBe(true)
})

it('treats path:line as a jump, not text to search', async () => {
  const search = vi.fn()
  const source = contentSource({ taskId: 't', search, open: () => undefined, limit: 5 })
  await source.query('a.ts:42', { signal: new AbortController().signal, limit: 5, mode: 'all' })
  expect(search).not.toHaveBeenCalled()
})
