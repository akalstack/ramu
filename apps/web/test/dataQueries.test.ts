import { afterEach, expect, it, vi } from 'vitest'
import { cachedData, invalidateData, ipcQueryKey, isDataQuery, queryClient } from '../src/dataQueries'

afterEach(() => queryClient.clear())

it('deduplicates concurrent reads and caches each session separately', async () => {
  let resolve!: (value: { id: string }) => void
  const fn = vi.fn(
    () =>
      new Promise<{ id: string }>((done) => {
        resolve = done
      }),
  )
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
  for (const method of ['agent.get', 'agent.events', 'files.list', 'files.search', 'git.status', 'reviews.get'])
    expect(isDataQuery(method)).toBe(true)
  for (const method of ['agent.start', 'term.open', 'term.write', 'term.resize', 'files.write', 'git.checkout'])
    expect(isDataQuery(method)).toBe(false)
})

it("keys reads by host, with the window's own host as the default", async () => {
  const { ipcQueryKeyOn, cachedDataOn, invalidateDataOn } = await import('../src/dataQueries')
  // No window in this environment: the own host is the local one, and a host-less key equals the local key.
  expect(ipcQueryKey('agent.get', 'one')).toEqual(['ipc', 'local', 'agent.get', 'one'])
  expect(ipcQueryKeyOn('local', 'agent.get', 'one')).toEqual(ipcQueryKey('agent.get', 'one'))
  queryClient.setQueryData(ipcQueryKeyOn('studio', 'agent.get', 'one'), { id: 'studio-one' })
  queryClient.setQueryData(ipcQueryKey('agent.get', 'one'), { id: 'local-one' })
  // The same session id on two hosts never shares a cache entry.
  expect(cachedDataOn('studio', 'agent.get', 'one')).toEqual({ id: 'studio-one' })
  expect(cachedData('agent.get', 'one')).toEqual({ id: 'local-one' })
  expect(cachedDataOn('laptop', 'agent.get', 'one')).toBeUndefined()

  await invalidateDataOn('studio', 'agent')
  expect(queryClient.getQueryState(ipcQueryKeyOn('studio', 'agent.get', 'one'))?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(ipcQueryKey('agent.get', 'one'))?.isInvalidated).toBe(false)
  await invalidateData()
  expect(queryClient.getQueryState(ipcQueryKey('agent.get', 'one'))?.isInvalidated).toBe(true)
})

it('invalidates every domain of one host when none is named', async () => {
  const { ipcQueryKeyOn, invalidateDataOn } = await import('../src/dataQueries')
  queryClient.setQueryData(ipcQueryKeyOn('studio', 'git.status', 'a'), 1)
  queryClient.setQueryData(ipcQueryKeyOn('studio', 'tasks.list'), 2)
  queryClient.setQueryData(ipcQueryKeyOn('nas', 'tasks.list'), 3)
  await invalidateDataOn('studio')
  expect(queryClient.getQueryState(ipcQueryKeyOn('studio', 'git.status', 'a'))?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(ipcQueryKeyOn('studio', 'tasks.list'))?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(ipcQueryKeyOn('nas', 'tasks.list'))?.isInvalidated).toBe(false)
})
