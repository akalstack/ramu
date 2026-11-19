import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const state = { role: 'owner' as 'owner' | 'viewer' | undefined, calls: vi.fn() }
let ipc: typeof import('../src/ipc')
beforeEach(async () => {
  vi.resetModules()
  state.role = 'owner'
  state.calls
    .mockReset()
    .mockImplementation(async (_host, method) => (method === 'background.status' ? { access: state.role } : []))
  vi.stubGlobal('window', {
    ramu: {
      hostId: 'local',
      invoke: (method: string, ...args: unknown[]) => state.calls('local', method, ...args),
      invokeOn: state.calls,
      on: () => () => {},
    },
  })
  ipc = await import('../src/ipc')
})
afterEach(async () => {
  ;(await import('../src/dataQueries')).queryClient.clear()
  vi.unstubAllGlobals()
})
it('refuses file/Git calls before cached reads and before the raw query bridge while allowing request answers', async () => {
  await ipc.invokeOn('a', 'files.list', 'task', 'repo', '')
  state.role = 'viewer'
  await ipc.invokeOn('a', 'background.status')
  state.calls.mockClear()
  const { queryInvokerFor } = await import('../src/git/hostQuery')
  await expect(ipc.invokeOn('a', 'files.list', 'task', 'repo', '')).rejects.toThrow('view-only')
  await expect(ipc.invokerFor('a')('git.stage', 'task', 'repo', ['file'])).rejects.toThrow('view-only')
  await expect(queryInvokerFor('a')('git.status', 'task', 'repo')).rejects.toThrow('view-only')
  await expect(ipc.invokeOn('a', 'term.write', 'terminal', 'must-not-run')).rejects.toThrow('view-only')
  await expect(ipc.invokeOn('a', 'term.list', 'task')).rejects.toThrow('view-only')
  expect(state.calls).not.toHaveBeenCalled()
  await ipc.invokeOn('a', 'agent.replyPermission', 'session', 'request', true)
  expect(state.calls).toHaveBeenCalledWith('a', 'agent.replyPermission', 'session', 'request', true)
})
it('retains confirmed viewer restrictions on missing access and restores only after an owner response', async () => {
  state.role = 'viewer'
  await ipc.invokeOn('a', 'background.status')
  state.role = undefined
  await ipc.invokeOn('a', 'background.status')
  await expect(ipc.invokeUncachedOn('a', 'files.read', 'task', 'repo', 'file')).rejects.toThrow('view-only')
  state.role = 'owner'
  await ipc.invokeOn('a', 'background.status')
  await ipc.invokeUncachedOn('a', 'files.read', 'task', 'repo', 'file')
  expect(state.calls).toHaveBeenCalledWith('a', 'files.read', 'task', 'repo', 'file')
})
it('isolates host roles and keeps this device clipboard and local files usable', async () => {
  state.role = 'viewer'
  await ipc.invokeOn('a', 'background.status')
  state.calls.mockClear()
  await ipc.invokeUncachedOn('b', 'git.status', 'task', 'repo')
  await ipc.invoke('files.list', 'task', 'repo', '')
  await ipc.copyText('local text')
  expect(state.calls.mock.calls.map(([host, method]) => [host, method])).toEqual([
    ['b', 'git.status'],
    ['local', 'files.list'],
    ['local', 'clipboard.write'],
  ])
})

it('ignores an older owner reply that arrives after a newer viewer status', async () => {
  let finish!: (value: unknown) => void
  state.calls.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const old = ipc.invokeUncachedOn('a', 'background.status')
  state.role = 'viewer'
  await ipc.invokeUncachedOn('a', 'background.status')
  finish({ access: 'owner' })
  await old
  state.calls.mockClear()
  await expect(ipc.invokeUncachedOn('a', 'git.status', 'task', 'repo')).rejects.toThrow('view-only')
  expect(state.calls).not.toHaveBeenCalled()
})
