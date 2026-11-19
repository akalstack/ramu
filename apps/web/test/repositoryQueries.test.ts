import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { repositoryQueryKey } from '../src/git/repositoryQueryKey'

const clients: QueryClient[] = []
const client = () => {
  const value = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(value)
  return value
}
const checkout = { repoId: 'repo', cwd: '/project' }
const worktree = { repoId: 'repo', cwd: '/worktrees/feature' }
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(() => clients.splice(0).forEach((value) => value.clear()))

it.each([checkout, worktree])(
  'shares cached Git state across thread switches and popover mounts in $cwd',
  async (binding) => {
    const cache = client()
    const queryKey = repositoryQueryKey('host', 'git.status', binding)
    await cache.fetchQuery({ queryKey, queryFn: async () => ({ branch: 'main', entries: ['file'] }) })
    const pending = deferred<{ branch: string; entries: string[] }>()
    const fetch = vi.fn(() => pending.promise)
    const statusBar = new QueryObserver(cache, { queryKey, queryFn: fetch })
    const stopStatusBar = statusBar.subscribe(() => {})
    // A new thread or popover uses the same checkout key while its refresh is pending.
    const popover = new QueryObserver(cache, { queryKey, queryFn: fetch })
    const stopPopover = popover.subscribe(() => {})
    expect(popover.getCurrentResult()).toMatchObject({ isLoading: false, data: { branch: 'main', entries: ['file'] } })
    expect(fetch).toHaveBeenCalledOnce()
    pending.resolve({ branch: 'feature', entries: [] })
    await statusBar.refetch({ cancelRefetch: false })
    expect(popover.getCurrentResult().data?.branch).toBe('feature')
    expect(statusBar.getCurrentResult().data?.branch).toBe('feature')
    stopStatusBar()
    stopPopover()
  },
)

it('isolates current checkouts, separate worktrees, repositories and hosts', async () => {
  const cache = client()
  const scopes = [
    ['host', checkout],
    ['host', worktree],
    ['host', { ...worktree, cwd: '/worktrees/another' }],
    ['other-host', checkout],
    ['host', { ...checkout, repoId: 'another-repo' }],
  ] as const
  for (const [index, [host, binding]] of scopes.entries())
    cache.setQueryData(repositoryQueryKey(host, 'git.status', binding), { branch: `branch-${index}` })
  for (const [index, [host, binding]] of scopes.entries())
    expect(cache.getQueryData(repositoryQueryKey(host, 'git.status', binding))).toEqual({ branch: `branch-${index}` })
  expect(cache.getQueryData(repositoryQueryKey('host', 'git.branches', checkout))).toBeUndefined()
})

it('does not display a late response from the checkout the user left', async () => {
  const cache = client()
  const pending = deferred<string>()
  const observer = new QueryObserver(cache, {
    queryKey: repositoryQueryKey('host', 'git.status', checkout),
    queryFn: () => pending.promise,
  })
  const stop = observer.subscribe(() => {})
  const nextKey = repositoryQueryKey('host', 'git.status', worktree)
  cache.setQueryData(nextKey, 'worktree-state')
  observer.setOptions({ queryKey: nextKey, queryFn: async () => 'worktree-state' })
  pending.resolve('old-checkout-state')
  await pending.promise
  await observer.refetch({ cancelRefetch: false })
  expect(observer.getCurrentResult().data).toBe('worktree-state')
  stop()
})

it('retains the last-known state when a background refresh fails', async () => {
  const cache = client()
  const queryKey = repositoryQueryKey('host', 'git.status', checkout)
  cache.setQueryData(queryKey, { branch: 'main' })
  await expect(
    cache.fetchQuery({
      queryKey,
      queryFn: async () => {
        throw new Error('offline')
      },
    }),
  ).rejects.toThrow('offline')
  expect(cache.getQueryData(queryKey)).toEqual({ branch: 'main' })
})

it('reuses known bindings while switching to another thread in the same checkout or worktree', async () => {
  const { effectiveBindings } = await import('../src/workspace/workspaceModel')
  const threads = [
    { id: 'current-a', projectId: 'project', workspaceId: null },
    { id: 'current-b', projectId: 'project', workspaceId: null },
    { id: 'worktree-a', projectId: 'project', workspaceId: 'feature' },
    { id: 'worktree-b', projectId: 'project', workspaceId: 'feature' },
    { id: 'other', projectId: 'project', workspaceId: 'another' },
  ] as import('@ramu/shared/types').Task[]
  const currentBindings = [checkout] as import('@ramu/shared/types').RepositoryBinding[]
  const worktreeBindings = [worktree] as import('@ramu/shared/types').RepositoryBinding[]
  const effective = effectiveBindings(threads, {
    'project:project': currentBindings,
    'worktree:feature': worktreeBindings,
  })
  expect(effective['current-a']).toBe(currentBindings)
  expect(effective['current-b']).toBe(currentBindings)
  expect(effective['worktree-a']).toBe(worktreeBindings)
  expect(effective['worktree-b']).toBe(worktreeBindings)
  expect(effective.other).toBeUndefined()
  // A completed task-specific read, including an empty result, takes precedence.
  expect(effectiveBindings(threads, { 'project:project': currentBindings, 'current-b': [] })['current-b']).toEqual([])
})
