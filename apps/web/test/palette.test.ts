import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPaletteEngine, type PaletteSnapshot } from '../src/palette/engine'
import { buildRows, firstRevealed, moveSelection, resolveSelection } from '../src/palette/rows'
import {
  capResults,
  parsePaletteQuery,
  rankTop,
  sourceApplies,
  type PaletteBatch,
  type PaletteOutput,
  type PaletteResult,
  type PaletteSource,
} from '../src/palette/sources'

const result = (key: string): PaletteResult => ({ key, label: key, run: () => undefined })
const batch = (...keys: string[]): PaletteBatch => ({ results: keys.map(result) })

const source = (id: string, patch: Partial<PaletteSource> = {}): PaletteSource => ({
  id,
  label: id,
  priority: 0,
  modes: ['all'],
  minLength: 0,
  debounceMs: 0,
  limit: 10,
  initialShow: 5,
  query: () => batch(),
  ...patch,
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}

const keys = (snapshot: PaletteSnapshot, id: string) =>
  snapshot.groups.find((group) => group.id === id)?.results.map((r) => r.key)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('reads mode prefixes and trims the text sources see', () => {
  expect(parsePaletteQuery('  foo ')).toEqual({ mode: 'all', text: 'foo' })
  expect(parsePaletteQuery('> open ')).toEqual({ mode: 'commands', text: 'open' })
  expect(parsePaletteQuery('#todo')).toEqual({ mode: 'content', text: 'todo' })
  expect(parsePaletteQuery('')).toEqual({ mode: 'all', text: '' })
})

it('applies the minimum length per mode and only to the modes a source declares', () => {
  const content = source('content', { modes: ['all', 'content'], minLength: 3, minLengthExplicit: 2 })
  expect(sourceApplies(content, parsePaletteQuery('ab'))).toBe(false)
  expect(sourceApplies(content, parsePaletteQuery('abc'))).toBe(true)
  expect(sourceApplies(content, parsePaletteQuery('#ab'))).toBe(true)
  expect(sourceApplies(content, parsePaletteQuery('#a'))).toBe(false)
  expect(sourceApplies(content, parsePaletteQuery('>abc'))).toBe(false)
})

it('caps results and reports when some were dropped', () => {
  expect(capResults([1, 2, 3], 3)).toEqual({ results: [1, 2, 3], limited: false })
  expect(capResults([1, 2, 3, 4], 3)).toEqual({ results: [1, 2, 3], limited: true })
})

it('ranks the top n of many items, best first, and counts every match', () => {
  const items = Array.from({ length: 1000 }, (_, i) => i)
  const top = rankTop(items, (n) => (n % 2 ? null : n), 5)
  expect(top.items).toEqual([998, 996, 994, 992, 990])
  expect(top.total).toBe(500)
})

it('answers synchronous sources before run returns', () => {
  const seen: PaletteSnapshot[] = []
  const engine = createPaletteEngine((snapshot) => seen.push(snapshot))
  engine.run([source('files', { query: () => batch('a', 'b') })], 'x')
  const last = seen.at(-1)!
  expect(keys(last, 'files')).toEqual(['a', 'b'])
  expect(last.pending).toBe(false)
  engine.dispose()
})

it('truncates a source to its limit and marks the group limited', () => {
  let last!: PaletteSnapshot
  const engine = createPaletteEngine((snapshot) => (last = snapshot))
  engine.run([source('files', { limit: 2, query: () => batch('a', 'b', 'c') })], 'x')
  expect(last.groups[0]).toMatchObject({ limited: true })
  expect(keys(last, 'files')).toEqual(['a', 'b'])
  engine.dispose()
})

it('orders groups by priority and keeps them separate', () => {
  let last!: PaletteSnapshot
  const engine = createPaletteEngine((snapshot) => (last = snapshot))
  engine.run(
    [
      source('late', { priority: 5, query: () => batch('z') }),
      source('early', { priority: 1, query: () => ({ results: [{ ...result('a'), label: 'zzz' }] }) }),
    ],
    'x',
  )
  expect(last.groups.map((group) => group.id)).toEqual(['early', 'late'])
  engine.dispose()
})

it('leaves out sources whose mode or minimum length does not fit', () => {
  let last!: PaletteSnapshot
  const engine = createPaletteEngine((snapshot) => (last = snapshot))
  const sources = [
    source('commands', { modes: ['commands'], query: () => batch('c') }),
    source('files', { query: () => batch('f') }),
    source('chats', { minLength: 2, query: () => batch('t') }),
  ]
  engine.run(sources, 'a')
  expect(last.groups.map((group) => group.id)).toEqual(['files'])
  engine.run(sources, '>a')
  expect(last.groups.map((group) => group.id)).toEqual(['commands'])
  engine.dispose()
})

it('debounces a slow source: fast groups appear at once, the slow one searches then fills in', async () => {
  let last!: PaletteSnapshot
  const query = vi.fn((): PaletteOutput => Promise.resolve(batch('hit')))
  const engine = createPaletteEngine((snapshot) => (last = snapshot))
  const sources = [
    source('files', { query: () => batch('f') }),
    source('content', { debounceMs: 250, priority: 2, query }),
  ]
  engine.run(sources, 'abc')
  expect(keys(last, 'files')).toEqual(['f'])
  expect(last.groups.find((g) => g.id === 'content')).toMatchObject({ status: 'loading', results: [] })
  expect(last.pending).toBe(true)
  await vi.advanceTimersByTimeAsync(249)
  expect(query).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(query).toHaveBeenCalledTimes(1)
  expect(keys(last, 'content')).toEqual(['hit'])
  expect(last.pending).toBe(false)
  engine.dispose()
})

it('runs only the last query when typing faster than the debounce', async () => {
  const query = vi.fn((text: string): PaletteOutput => Promise.resolve(batch(text)))
  const engine = createPaletteEngine(() => undefined)
  const sources = [source('content', { debounceMs: 250, query })]
  for (const text of ['abc', 'abcd', 'abcde']) {
    engine.run(sources, text)
    await vi.advanceTimersByTimeAsync(100)
  }
  await vi.advanceTimersByTimeAsync(250)
  expect(query).toHaveBeenCalledTimes(1)
  expect(query.mock.calls[0]![0]).toBe('abcde')
  engine.dispose()
})

it('aborts the previous request on a new keystroke and ignores its late response', async () => {
  let last!: PaletteSnapshot
  const first = deferred<PaletteBatch>()
  const second = deferred<PaletteBatch>()
  const signals: AbortSignal[] = []
  const pending = [first, second]
  const engine = createPaletteEngine((snapshot) => (last = snapshot))
  const sources = [
    source('content', {
      debounceMs: 10,
      query: (_text, { signal }) => {
        signals.push(signal)
        return pending.shift()!.promise
      },
    }),
  ]
  engine.run(sources, 'abc')
  await vi.advanceTimersByTimeAsync(10)
  engine.run(sources, 'abcd')
  expect(signals[0]!.aborted).toBe(true)
  await vi.advanceTimersByTimeAsync(10)
  second.resolve(batch('new'))
  await vi.advanceTimersByTimeAsync(0)
  first.resolve(batch('old'))
  await vi.advanceTimersByTimeAsync(0)
  expect(keys(last, 'content')).toEqual(['new'])
  expect(signals[1]!.aborted).toBe(false)
  engine.dispose()
})

it('ignores a late response after the source stops applying', async () => {
  let last!: PaletteSnapshot
  const slow = deferred<PaletteBatch>()
  const engine = createPaletteEngine((snapshot) => (last = snapshot))
  const sources = [source('content', { minLength: 3, debounceMs: 10, query: () => slow.promise })]
  engine.run(sources, 'abc')
  await vi.advanceTimersByTimeAsync(10)
  engine.run(sources, 'ab')
  slow.resolve(batch('late'))
  await vi.advanceTimersByTimeAsync(0)
  expect(last.groups).toEqual([])
  engine.dispose()
})

it('shows the previous results dimmed while a refreshed query runs, only within the same scope', async () => {
  let last!: PaletteSnapshot
  const engine = createPaletteEngine((snapshot) => (last = snapshot))
  const make = (scope: string) => [
    source('content', { debounceMs: 10, scope, query: (text) => Promise.resolve(batch(`${scope}:${text}`)) }),
  ]
  engine.run(make('a'), 'abc')
  await vi.advanceTimersByTimeAsync(10)
  engine.run(make('a'), 'abcd')
  expect(last.groups[0]).toMatchObject({ stale: true, status: 'loading' })
  expect(keys(last, 'content')).toEqual(['a:abc'])
  engine.run(make('b'), 'abcd')
  expect(last.groups[0]).toMatchObject({ stale: false, results: [] })
  engine.dispose()
})

it('does not restart a running search when only the sources are rebuilt', async () => {
  const query = vi.fn((): PaletteOutput => Promise.resolve(batch('hit')))
  const engine = createPaletteEngine(() => undefined)
  const make = () => [source('content', { debounceMs: 10, scope: 't', query })]
  engine.run(make(), 'abc')
  await vi.advanceTimersByTimeAsync(5)
  engine.run(make(), 'abc')
  await vi.advanceTimersByTimeAsync(10)
  engine.run(make(), 'abc')
  await vi.advanceTimersByTimeAsync(50)
  expect(query).toHaveBeenCalledTimes(1)
  engine.dispose()
})

it('streams batches into the group and stops at the cap', async () => {
  let last!: PaletteSnapshot
  const gate = deferred<void>()
  let closed = false
  async function* stream() {
    try {
      yield batch('a', 'b')
      await gate.promise
      yield batch('c', 'd')
      yield batch('e')
    } finally {
      closed = true
    }
  }
  const engine = createPaletteEngine((snapshot) => (last = snapshot))
  engine.run([source('content', { limit: 3, debounceMs: 1, query: stream })], 'abc')
  await vi.advanceTimersByTimeAsync(1)
  expect(keys(last, 'content')).toEqual(['a', 'b'])
  expect(last.groups[0]!.status).toBe('loading')
  gate.resolve()
  await vi.advanceTimersByTimeAsync(0)
  expect(keys(last, 'content')).toEqual(['a', 'b', 'c'])
  expect(last.groups[0]).toMatchObject({ status: 'done', limited: true })
  expect(closed).toBe(true)
  engine.dispose()
})

it('reports a failing source without disturbing the others, and ignores a failure from a cancelled query', async () => {
  let last!: PaletteSnapshot
  const failing = deferred<PaletteBatch>()
  const engine = createPaletteEngine((snapshot) => (last = snapshot))
  const files = source('files', { query: () => batch('f') })
  engine.run(
    [files, source('content', { debounceMs: 1, priority: 2, query: () => Promise.reject(new Error('rg missing')) })],
    'abc',
  )
  await vi.advanceTimersByTimeAsync(1)
  expect(last.groups.find((g) => g.id === 'content')).toMatchObject({ status: 'error', error: 'rg missing' })
  expect(keys(last, 'files')).toEqual(['f'])

  const slow = source('content', { debounceMs: 1, priority: 2, query: () => failing.promise })
  engine.run([files, slow], 'abcd')
  await vi.advanceTimersByTimeAsync(1)
  engine.run([files], 'abcd')
  failing.reject(new Error('aborted'))
  await vi.advanceTimersByTimeAsync(0)
  expect(last.groups.map((g) => g.id)).toEqual(['files'])
  engine.dispose()
})

it('turns a throwing synchronous source into an error group', () => {
  let last!: PaletteSnapshot
  const engine = createPaletteEngine((snapshot) => (last = snapshot))
  engine.run(
    [
      source('files', {
        query: () => {
          throw new Error('boom')
        },
      }),
    ],
    'x',
  )
  expect(last.groups[0]).toMatchObject({ status: 'error', error: 'boom' })
  engine.dispose()
})

it('stops publishing and aborts in-flight work once disposed', async () => {
  const onChange = vi.fn()
  let signal!: AbortSignal
  const slow = deferred<PaletteBatch>()
  const engine = createPaletteEngine(onChange)
  engine.run(
    [
      source('content', {
        debounceMs: 1,
        query: (_text, context) => {
          signal = context.signal
          return slow.promise
        },
      }),
    ],
    'abc',
  )
  await vi.advanceTimersByTimeAsync(1)
  const calls = onChange.mock.calls.length
  engine.dispose()
  slow.resolve(batch('x'))
  await vi.advanceTimersByTimeAsync(0)
  expect(signal.aborted).toBe(true)
  expect(onChange).toHaveBeenCalledTimes(calls)
})

const group = (id: string, count: number, patch: Partial<Parameters<typeof buildRows>[0][number]> = {}) => ({
  id,
  label: id,
  priority: 0,
  initialShow: 3,
  status: 'done' as const,
  results: Array.from({ length: count }, (_, i) => result(`${id}${i}`)),
  limited: false,
  stale: false,
  ...patch,
})

it('shows each group top results with a show-more row, then everything once expanded', () => {
  const rows = buildRows([group('files', 5), group('chats', 2)], new Set())
  expect(rows.map((row) => row.kind)).toEqual([
    'header',
    'result',
    'result',
    'result',
    'more',
    'header',
    'result',
    'result',
  ])
  expect(rows.find((row) => row.kind === 'more')).toMatchObject({ hidden: 2, group: 'files' })
  const open = buildRows([group('files', 5), group('chats', 2)], new Set(['files']))
  expect(open.filter((row) => row.kind === 'result')).toHaveLength(7)
  expect(open.some((row) => row.kind === 'more')).toBe(false)
})

it('omits empty finished groups, shows loading and error states and the limit note', () => {
  const rows = buildRows(
    [
      group('empty', 0),
      group('content', 0, { status: 'loading' }),
      group('broken', 0, { status: 'error', error: 'nope' }),
      group('files', 1, { limited: true }),
    ],
    new Set(),
  )
  expect(rows.map((row) => row.kind)).toEqual(['header', 'loading', 'header', 'error', 'header', 'result', 'limited'])
  expect(rows.at(-1)).toMatchObject({ kind: 'limited', shown: 1 })
})

it('does not add a loading row over dimmed previous results', () => {
  const rows = buildRows([group('content', 2, { status: 'loading', stale: true })], new Set())
  expect(rows.map((row) => row.kind)).toEqual(['header', 'result', 'result'])
  expect(rows.filter((row) => row.kind === 'result').every((row) => row.kind === 'result' && row.stale)).toBe(true)
})

it('keeps result keys unique across groups', () => {
  const rows = buildRows(
    [group('a', 1, { results: [result('x')] }), group('b', 1, { results: [result('x')] })],
    new Set(),
  )
  const all = rows.map((row) => row.key)
  expect(new Set(all).size).toBe(all.length)
})

it('moves the selection over selectable rows only, wrapping, and survives list changes', () => {
  const rows = buildRows([group('files', 5)], new Set())
  const first = resolveSelection(rows, null)
  expect(first).toBe('files:files0')
  const down = moveSelection(rows, first, 1)
  expect(down).toBe('files:files1')
  expect(moveSelection(rows, 'files:files2', 1)).toBe('m:files')
  expect(moveSelection(rows, 'm:files', 1)).toBe('files:files0')
  expect(moveSelection(rows, 'files:files0', -1)).toBe('m:files')
  expect(resolveSelection(rows, 'gone')).toBe('files:files0')
  expect(resolveSelection(rows, 'files:files1')).toBe('files:files1')
  expect(moveSelection([], null, 1)).toBeNull()
})

it('selects the first newly revealed result after show more', () => {
  expect(firstRevealed(group('files', 5))).toBe('files:files3')
  expect(firstRevealed(group('files', 2))).toBeNull()
})
