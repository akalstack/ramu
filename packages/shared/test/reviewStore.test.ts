import { expect, test, vi } from 'vitest'
import { createSharedResource } from '../src/asyncResource'

test('review consumers share one request and receive the cached summary', async () => {
  let resolve!: (reviews: { id: string }[]) => void
  const load = vi.fn(
    () =>
      new Promise<{ id: string }[]>((done) => {
        resolve = done
      }),
  )
  const store = createSharedResource(load, [])
  const consumers = Array.from({ length: 20 }, () => vi.fn())
  const off = consumers.map((consumer) => store.subscribe(consumer))
  expect(load).toHaveBeenCalledTimes(1)
  resolve([{ id: 'saved-review' }])
  await store.reload()
  expect(store.getSnapshot().loaded).toBe(true)
  expect(store.getSnapshot().value[0]?.id).toBe('saved-review')
  for (const consumer of consumers) expect(consumer).toHaveBeenCalledTimes(1)
  expect(load).toHaveBeenCalledTimes(1)
  off.forEach((unsubscribe) => unsubscribe())
})

test('changes during a pending read schedule one follow-up, without losing the latest data', async () => {
  const resolves: ((reviews: { id: string }[]) => void)[] = []
  const load = vi.fn(() => new Promise<{ id: string }[]>((done) => resolves.push(done)))
  const store = createSharedResource(load, [])
  const off = store.subscribe(() => {})
  for (let i = 0; i < 30; i++) store.invalidate()
  expect(load).toHaveBeenCalledTimes(1)
  resolves[0]!([{ id: 'old' }])
  await store.reload()
  expect(load).toHaveBeenCalledTimes(2)
  resolves[1]!([{ id: 'new' }])
  await store.reload()
  expect(store.getSnapshot().value[0]?.id).toBe('new')
  expect(load).toHaveBeenCalledTimes(2)
  off()
})

test('a failed read can recover and unsubscribed consumers stop receiving updates', async () => {
  const load = vi.fn<() => Promise<string[]>>().mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValue([])
  const store = createSharedResource(load, []),
    consumer = vi.fn(),
    off = store.subscribe(consumer)
  await store.reload()
  expect(store.getSnapshot().error).toContain('Disconnected')
  store.invalidate()
  await store.reload()
  expect(store.getSnapshot().error).toBeNull()
  expect(store.getSnapshot().loaded).toBe(true)
  off()
  consumer.mockClear()
  await store.reload()
  expect(consumer).not.toHaveBeenCalled()
})
