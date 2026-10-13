import { afterEach, expect, it, vi } from 'vitest'
import { cachedData, invalidateData, ipcQueryKey, isDataQuery, queryClient } from '../src/renderer/src/dataQueries'

afterEach(() => queryClient.clear())

it('deduplicates concurrent reads and caches each session separately', async () => {
  let resolve!: (value: { id: string }) => void
  const fn = vi.fn(() => new Promise<{ id: string }>(done => { resolve = done }))
  const options = { queryKey: ipcQueryKey('agent.get', 'one'), queryFn: fn }
  const first = queryClient.fetchQuery(options)
  const second = queryClient.fetchQuery(options)
  resolve({ id: 'one' })
  expect(await first).toEqual({ id: 'one' })
  expect(await second).toEqual({ id: 'one' })
  expect(fn).toHaveBeenCalledOnce()
  expect(cachedData('agent.get', 'one')).toEqual({ id: 'one' })
  expect(cachedData('agent.get', 'two')).toBeUndefined()
})

it('invalidates the changed domain while keeping cached data for background refresh', async () => {
  queryClient.setQueryData(ipcQueryKey('agent.get', 'one'), { id: 'one' })
  queryClient.setQueryData(ipcQueryKey('git.status', 'workspace', 'repo'), { branch: 'main' })
  await invalidateData('git')
  expect(queryClient.getQueryState(ipcQueryKey('git.status', 'workspace', 'repo'))?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(ipcQueryKey('agent.get', 'one'))?.isInvalidated).toBe(false)
  expect(cachedData('agent.get', 'one')).toEqual({ id: 'one' })
})

it('caches data reads without caching commands or shell operations', () => {
  for (const method of ['agent.get', 'agent.events', 'files.list', 'files.search', 'git.status', 'reviews.get']) expect(isDataQuery(method)).toBe(true)
  for (const method of ['agent.start', 'term.open', 'term.write', 'term.resize', 'files.write', 'git.checkout']) expect(isDataQuery(method)).toBe(false)
})
