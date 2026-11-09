import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('opens a pull request read on what this device last saw for that host, stale so it reads again', async () => {
  const data = new Map<string, string>()
  vi.stubGlobal('window', { ramu: { hostId: 'local' } })
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
  })
  const { queryClient, ipcQueryKeyOn } = await import('../src/dataQueries')
  const { keptPullRequestRead } = await import('../src/git/keptPullRequests')
  const description = { body: 'Adds login', html: null }
  await queryClient.fetchQuery({
    queryKey: ipcQueryKeyOn('studio', 'forge.pullRequestDescription', 't', 'r', 'https://x/pull/1'),
    queryFn: async () => description,
  })
  // A fresh start of the app opens the same read on the kept copy, for that host and pull request only.
  vi.resetModules()
  const fresh = await import('../src/git/keptPullRequests')
  const kept = fresh.keptPullRequestRead('studio', 'forge.pullRequestDescription', 't', 'r', 'https://x/pull/1')
  expect(kept.initialData()).toEqual(description)
  expect(kept.initialDataUpdatedAt).toBe(0)
  expect(
    fresh.keptPullRequestRead('other', 'forge.pullRequestDescription', 't', 'r', 'https://x/pull/1').initialData(),
  ).toBeUndefined()
  expect(
    keptPullRequestRead('studio', 'forge.pullRequestDescription', 't', 'r', 'https://x/pull/2').initialData(),
  ).toBeUndefined()
})
