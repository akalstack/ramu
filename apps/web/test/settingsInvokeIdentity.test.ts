import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  ref: { current: null as unknown },
  deps: [] as unknown[],
  value: undefined as unknown,
  invoke: vi.fn(),
}))
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useRef: () => state.ref,
  useMemo: (run: () => unknown, deps: unknown[]) => {
    if (state.value && deps.length === state.deps.length && deps.every((dep, index) => dep === state.deps[index]))
      return state.value
    state.deps = deps
    state.value = run()
    return state.value
  },
}))
vi.mock('../src/ipc', () => ({ invoke: state.invoke, invokeOn: state.invoke, ramu: {} }))
vi.mock('../src/workspace/computers', () => ({ useComputers: () => null, statusText: String }))
vi.mock('../src/Menu', () => ({ Dropdown: () => null }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text }))
import { useScopedInvoke, type SettingsScope } from '../src/settings/SettingsScope'
const scope = (id: string) =>
  ({ primaryId: id, target: id, ready: true, targets: [{ id, viewOnly: false }] }) as SettingsScope
beforeEach(() => {
  state.value = undefined
  state.deps = []
  state.invoke.mockReset().mockResolvedValue(undefined)
})
it('keeps a stable route within a snapshot, invalidates host-bound loads, and refuses the old route', async () => {
  const a = scope('a')
  const original = useScopedInvoke(a)
  expect(useScopedInvoke({ ...a })).toBe(original)
  const b = scope('b')
  const next = useScopedInvoke(b)
  expect(next).not.toBe(original)
  await expect(original('rules.list')).rejects.toThrow('host changed')
  expect(state.invoke).not.toHaveBeenCalled()
  await next('rules.list')
  expect(state.invoke).toHaveBeenCalledWith('computers.settings.invoke', 'b', 'rules.list', [])
})
it('invalidates loads when access/readiness changes without allowing stale viewer writes', async () => {
  const original = scope('a')
  const route = useScopedInvoke(original)
  const viewer = { ...original, targets: [{ id: 'a', viewOnly: true }] } as SettingsScope
  expect(useScopedInvoke(viewer)).not.toBe(route)
  await expect(route('background.restart')).rejects.toThrow('view-only')
  const stale = { ...viewer, stale: true }
  const staleRoute = useScopedInvoke(stale)
  expect(staleRoute).not.toBe(route)
  await expect(staleRoute('settings.app.snapshot')).rejects.toThrow('connected host')
  expect(state.invoke).not.toHaveBeenCalled()
})
it('reads ability checks across all hosts from the primary host, but still asks for one host before an action', async () => {
  const all = {
    primaryId: 'a',
    target: 'all',
    ready: true,
    targets: [
      { id: 'a', viewOnly: false },
      { id: 'b', viewOnly: false },
    ],
  } as SettingsScope
  const route = useScopedInvoke(all)
  await route('abilities.checks')
  await route('abilities.mcpTools')
  expect(state.invoke).toHaveBeenCalledWith('computers.settings.invoke', 'a', 'abilities.checks', [])
  expect(state.invoke).toHaveBeenCalledWith('computers.settings.invoke', 'a', 'abilities.mcpTools', [])
  await expect(route('abilities.check', 'claude')).rejects.toThrow('Choose one host')
})
