import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  ref: { current: null as unknown },
  invoke: vi.fn(),
}))
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useRef: () => state.ref,
  useMemo: (run: () => unknown) => run(),
}))
vi.mock('../src/workspace/computers', () => ({ useComputers: () => null, statusText: (text: string) => text }))
vi.mock('../src/Menu', () => ({ Dropdown: () => null }))
vi.mock('../src/ipc', () => ({ invoke: state.invoke, invokeOn: state.invoke, ramu: {} }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text }))
import { useScopedInvoke, type SettingsScope } from '../src/settings/SettingsScope'

const scope = (viewer: boolean, id = 'host') =>
  ({
    ready: true,
    stale: false,
    target: id,
    primaryId: id,
    targets: [{ id, name: id, viewOnly: viewer }],
  }) as SettingsScope

beforeEach(() => {
  state.ref.current = null
  state.invoke.mockReset().mockResolvedValue({})
})

it('refuses viewer host actions and admin reads even when their names look read-only', async () => {
  const invoke = useScopedInvoke(scope(true))
  for (const method of ['background.restart', 'remote.devices.list', 'providers.status', 'settings.app.patch']) {
    await expect((invoke as any)(method)).rejects.toThrow('view-only')
  }
  expect(state.invoke).not.toHaveBeenCalled()
  await invoke('settings.app.snapshot')
  expect(state.invoke).toHaveBeenCalledWith('computers.settings.invoke', 'host', 'settings.app.snapshot', [])
})

it('a retained callback refuses to retarget an old action to another host', async () => {
  const retained = useScopedInvoke(scope(false, 'a'))
  useScopedInvoke(scope(true, 'b'))
  await expect(retained('background.restart')).rejects.toThrow('host changed')
  expect(state.invoke).not.toHaveBeenCalled()
  const fresh = useScopedInvoke(scope(false, 'b'))
  await expect(retained('background.restart')).rejects.toThrow('host changed')
  await fresh('background.restart')
  expect(state.invoke).toHaveBeenCalledWith('computers.settings.invoke', 'b', 'background.restart', [])
})

it('keeps device-local computer management available and retains the bulk action restriction', async () => {
  const invoke = useScopedInvoke(scope(true))
  await invoke('computers.list')
  expect(state.invoke).toHaveBeenCalledWith('computers.list')
  useScopedInvoke({ ...scope(false), target: 'all', targets: [{ id: 'a' }, { id: 'b' }] } as SettingsScope)
  await expect(invoke('background.restart')).rejects.toThrow('Choose one host')
})

it('a retained action rechecks the role when reconnecting to the same host', async () => {
  const retained = useScopedInvoke(scope(false))
  useScopedInvoke(scope(true))
  await expect(retained('background.restart')).rejects.toThrow('view-only')
  useScopedInvoke(scope(false))
  await retained('background.restart')
  expect(state.invoke).toHaveBeenCalledWith('computers.settings.invoke', 'host', 'background.restart', [])
})
