import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ramu = {
  hostId: 'local',
  invoke: vi.fn(async (method: string, ..._args: unknown[]) => `own:${method}`),
  invokeOn: vi.fn(async (host: string, method: string, ..._args: unknown[]) => `${host}:${method}`),
  on: vi.fn(),
  deviceState: {},
  setDeviceState: vi.fn(),
}
beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('window', { ramu })
  ramu.invoke.mockClear()
  ramu.invokeOn.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

describe('host-addressed invoke', () => {
  it('sends host-less calls and own-host calls through the plain bridge', async () => {
    const { invoke, invokeOn } = await import('../src/ipc')
    expect(await invoke('tasks.list')).toBe('own:tasks.list')
    expect(await invokeOn('local', 'tasks.list')).toBe('own:tasks.list')
    expect(ramu.invokeOn).not.toHaveBeenCalled()
  })

  it('routes another host through invokeOn, with its own cache and invalidation', async () => {
    const { invokeOn, invoke } = await import('../src/ipc')
    const { cachedDataOn, ipcQueryKeyOn, queryClient } = await import('../src/dataQueries')
    expect(await invokeOn('studio', 'tasks.list')).toBe('studio:tasks.list')
    expect(ramu.invokeOn).toHaveBeenCalledWith('studio', 'tasks.list')
    expect(cachedDataOn('studio', 'tasks.list')).toBe('studio:tasks.list')
    // The same read on the own host is a separate entry.
    expect(queryClient.getQueryData(ipcQueryKeyOn('local', 'tasks.list'))).toBeUndefined()
    await invoke('tasks.list')
    expect(queryClient.getQueryData(ipcQueryKeyOn('local', 'tasks.list'))).toBe('own:tasks.list')
    // A write on studio marks studio's task reads stale, and not the own host's.
    await invokeOn('studio', 'tasks.pin', 't', true)
    expect(queryClient.getQueryState(ipcQueryKeyOn('studio', 'tasks.list'))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(ipcQueryKeyOn('local', 'tasks.list'))?.isInvalidated).toBe(false)
    queryClient.clear()
  })

  it('passes rejections from the shell through unchanged', async () => {
    ramu.invokeOn.mockRejectedValueOnce(new Error('That host is not reachable right now.'))
    const { invokeOn } = await import('../src/ipc')
    await expect(invokeOn('laptop', 'tasks.pin', 't', true)).rejects.toThrow('not reachable')
  })

  it('binds a stable invoker per host', async () => {
    const { invokerFor, invoke } = await import('../src/ipc')
    expect(invokerFor('studio')).toBe(invokerFor('studio'))
    expect(invokerFor('local')).toBe(invoke)
    expect(await invokerFor('studio')('tasks.pin', 't', true)).toBe('studio:tasks.pin')
    expect(ramu.invokeOn).toHaveBeenCalledWith('studio', 'tasks.pin', 't', true)
  })

  it('uses the host named by the preload for a remote window', async () => {
    vi.stubGlobal('window', { ramu: { ...ramu, hostId: 'studio' } })
    const { invoke, invokeOn } = await import('../src/ipc')
    const { ipcQueryKey } = await import('../src/dataQueries')
    expect(ipcQueryKey('agent.get', 's')).toEqual(['ipc', 'studio', 'agent.get', 's'])
    await invoke('tasks.list')
    expect(ramu.invoke).toHaveBeenCalledWith('tasks.list')
    await invokeOn('local', 'tasks.list')
    expect(ramu.invokeOn).toHaveBeenCalledWith('local', 'tasks.list')
  })
})
