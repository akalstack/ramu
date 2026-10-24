import { beforeEach, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
const state = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  invoke: vi.fn(),
  status: { enabled: true, runtime: { available: true, computer: { name: 'Host' } }, apps: null, globalPointer: false },
}))
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useRef: (value: unknown) => (state.slots[state.cursor++] ??= { current: value }),
  useState: (value: unknown) => {
    const index = state.cursor++
    if (!(index in state.slots)) state.slots[index] = index === 1 ? state.status : value
    return [state.slots[index], vi.fn()]
  },
  useEffect() {},
  useCallback: (run: unknown) => run,
}))
vi.mock('../src/settings/SettingsScope', async () => ({
  SettingsScopeContext: (await import('react')).createContext(null),
}))
vi.mock('../src/settings/KeepAwakeSettings', () => ({ KeepAwakeSettings: () => null }))
vi.mock('../src/workspace/computers', () => ({ useComputers: () => null }))
vi.mock('../src/hosts', () => ({ ownHostId: () => 'local' }))
vi.mock('../src/ipc', () => ({ invokeOn: state.invoke, ramu: { invoke: state.invoke } }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text, useLanguage() {} }))
vi.mock('@/components/settings-row', () => ({ SettingsGroupTitle: 'h4', SettingsRow: 'div', SettingsLabel: 'label' }))
vi.mock('@/components/desktop-button', () => ({ Button: 'Button' }))
vi.mock('@/components/ui/switch', () => ({ Switch: 'Switch' }))
import { ComputerSettings } from '../src/settings/ComputerSettings'
type Node = ReactElement<Record<string, any>>
const nodes = (value: unknown): Node[] => {
  if (!value || typeof value !== 'object') return []
  const node = value as Node
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]
}
const RenderComputer = (readOnly = false, hostId = 'a') => {
  state.cursor = 0
  return ComputerSettings({ hostId, readOnly })
}
beforeEach(() => {
  state.slots = []
  state.invoke.mockReset().mockResolvedValue(undefined)
})
it('does not offer host computer administration to a viewer', () => {
  const viewer = nodes(RenderComputer(true))
  expect(viewer.some((node) => node.props?.role === 'status')).toBe(true)
  expect(viewer.some((node) => String(node.props?.children).includes('view-only'))).toBe(true)
  expect(viewer.some((node) => node.type === 'Switch' || node.type === 'Button')).toBe(false)
})
it.each(['viewer', 'host switch'])('refuses retained computer controls after a %s change', async (change) => {
  const controls = nodes(RenderComputer())
  const toggle = controls.find((node) => node.props?.['aria-label'] === 'Let agents use this computer')!
  const reset = controls.find((node) => node.type === 'Button' && node.props?.children === 'Reset defaults')!
  RenderComputer(change === 'viewer', change === 'viewer' ? 'a' : 'b')
  toggle.props.onCheckedChange(true)
  await reset.props.onClick()
  await Promise.resolve()
  expect(state.invoke).not.toHaveBeenCalled()
})
