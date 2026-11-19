import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import type { RepositoryBinding } from '@ramu/shared/types'
import { RepositoryPicker } from '../src/git/RepositoryPicker'

const rig = vi.hoisted(() => ({
  open: false,
  results: [] as { data?: { branch: string | null; detached?: boolean; oid?: string }; isError?: boolean }[],
  queries: vi.fn(),
  controls: [] as { binding: RepositoryBinding; onChange: (branch: string) => void }[],
  syncs: [] as { onSync: () => void }[],
  call: vi.fn(),
}))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: () => [rig.open, vi.fn()],
}))
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQueries: (options: unknown) => {
    rig.queries(options)
    const queries = (options as { queries: { queryKey: string[] }[] }).queries
    return queries[0]?.queryKey[2] === 'git.branches' ? bindings.map(() => ({ data: [{ name: 'main' }] })) : rig.results
  },
}))
vi.mock('../src/i18n', () => ({
  useLanguage: () => {},
  t: (text: string, values?: Record<string, string>) => text.replace('{0}', values?.['0'] ?? ''),
}))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ id: 'remote-host' }) }))
vi.mock('../src/git/hostQuery', () => ({ queryInvokerFor: () => rig.call }))
vi.mock('@/components/desktop-button', () => ({ Button: 'button' }))
vi.mock('@/components/ui/popover', () => {
  const component =
    (tag: string) =>
    ({ children }: { children?: ReactNode }) =>
      createElement(tag, {}, children)
  return {
    Popover: component('div'),
    PopoverTrigger: component('button'),
    PopoverContent: component('div'),
    PopoverTitle: component('header'),
  }
})
vi.mock('../src/git/gitBusy', () => ({ useGitBusy: () => false }))
vi.mock('../src/git/GitControls', () => ({
  SyncButton: (props: { onSync: () => void }) => {
    rig.syncs.push(props)
    return createElement('button', {}, 'Sync')
  },
  BranchPicker: (props: {
    binding: RepositoryBinding
    status: { branch: string | null }
    onChange: (branch: string) => void
  }) => {
    rig.controls.push(props)
    return createElement('button', {}, props.status.branch ?? 'No commits')
  },
}))
const bindings = [
  { repoId: 'api', repoName: 'API', cwd: '/project/api', setupState: 'ready' },
  { repoId: 'web', repoName: 'Web', cwd: '/worktrees/web', setupState: 'ready' },
] as RepositoryBinding[]
const change = vi.fn()
const checkout = vi.fn()
const sync = vi.fn()
const syncAll = vi.fn()
const render = () =>
  RepositoryPicker({
    taskId: 'thread',
    bindings,
    value: 'web',
    onChange: change,
    onBranchChange: checkout,
    onSync: sync,
    onSyncAll: syncAll,
    onPublishRepository: vi.fn(),
    pullMode: 'rebase',
  })
function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...[node.props.children].flat(Infinity).flatMap(elements)]
}
beforeEach(() => {
  vi.clearAllMocks()
  rig.open = false
  rig.controls = []
  rig.syncs = []
  rig.results = [{ data: { branch: 'main' } }, { data: { branch: 'feature/login' } }]
})
it('shows every repository with its live checkout branch and marks the selected repository', () => {
  const tree = render()
  const html = renderToStaticMarkup(tree)
  expect(html).toContain('API')
  expect(html).toContain('main')
  expect(html).toContain('Web')
  expect(html).toContain('feature/login')
  const repo = elements(tree).find((element) => element.props.title === '/project/api')!
  expect(repo.props['aria-pressed']).toBe(false)
  ;(repo.props.onClick as () => void)()
  expect(change).toHaveBeenCalledExactlyOnceWith('api')
  rig.controls.find((control) => control.binding.repoId === 'api')!.onChange('feature/api')
  expect(checkout).toHaveBeenCalledExactlyOnceWith(bindings[0], 'feature/api')
  rig.syncs[0]!.onSync()
  expect(sync).toHaveBeenCalledExactlyOnceWith(bindings[0])
  const all = elements(tree).find(
    (element) => element.props.children instanceof Array && element.props.children.includes('Sync all'),
  )!
  ;(all.props.onClick as () => void)()
  expect(syncAll).toHaveBeenCalledOnce()
  expect(rig.call).not.toHaveBeenCalled()
})
it('loads on opening and uses host, repository and checkout scoped cache keys', async () => {
  render()
  expect(rig.queries.mock.calls.at(-2)?.[0].queries.every((query: { enabled: boolean }) => !query.enabled)).toBe(true)
  rig.open = true
  render()
  const queries = rig.queries.mock.calls.at(-2)?.[0].queries
  expect(queries.map((query: { queryKey: unknown; enabled: boolean }) => [query.queryKey, query.enabled])).toEqual([
    [['ipc', 'remote-host', 'git.status', 'checkout', 'api', '/project/api'], true],
    [['ipc', 'remote-host', 'git.status', 'checkout', 'web', '/worktrees/web'], true],
  ])
  await queries[1].queryFn()
  expect(rig.call).toHaveBeenCalledExactlyOnceWith('git.status', 'thread', 'web')
})
it('distinguishes loading and failed reads, retaining a known branch on refresh failure', () => {
  rig.results = [{}, { isError: true }]
  expect(renderToStaticMarkup(render())).toContain('Loading…')
  expect(renderToStaticMarkup(render())).toContain('Could not load branch')
  rig.results = [{ data: { branch: 'cached' }, isError: true }, { data: { branch: null } }]
  const html = renderToStaticMarkup(render())
  expect(html).toContain('cached')
  expect(html).toContain('No commits')
  expect(html).not.toContain('Could not load branch')
})
