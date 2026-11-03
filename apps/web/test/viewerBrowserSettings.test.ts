import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
const state = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  hostPanel: false,
  scope: { primaryId: 'remote', target: 'remote', targets: [{ id: 'remote', viewOnly: false }] },
  invoke: vi.fn(),
  runCommand: vi.fn(),
  localPreference: vi.fn(),
  change: vi.fn(),
}))
// Staged settings apply on Save; here they apply at once so each write path still meets its access check.
vi.mock('../src/settings/stagedChanges', () => ({
  useStagedValue: (_key: string, saved: unknown, apply: (value: unknown) => unknown) => [saved, apply],
  useStaging: () => ({
    valueOf: (_key: string, saved: unknown) => saved,
    stage: (_key: string, value: unknown, _saved: unknown, apply: (value: unknown) => unknown) => apply(value),
  }),
}))
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useRef: (value: unknown) => (state.slots[state.cursor++] ??= { current: value }),
  useState: (value: unknown) => {
    const index = state.cursor++
    if (!(index in state.slots))
      state.slots[index] =
        state.hostPanel && index === 1
          ? { enabled: true, available: true }
          : typeof value === 'function'
            ? value()
            : value
    return [state.slots[index], vi.fn()]
  },
  useEffect() {},
  useCallback: (run: unknown) => run,
  useContext: () => state.scope,
}))
vi.mock('../src/settings/SettingsScope', async () => ({
  SettingsScopeContext: (await import('react')).createContext(null),
  useSettingsInvoke: () => state.invoke,
  useSettingsEvents: () => () => () => {},
}))
vi.mock('../src/hosts', () => ({ ownHostId: () => 'local' }))
vi.mock('../src/deviceStorage', () => ({ deviceStorage: { getItem: () => null, setItem: state.localPreference } }))
vi.mock('../src/ipc', () => ({ invokeOn: state.invoke, ramu: { invoke: state.invoke }, bridge: {} }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text, useLanguage() {} }))
vi.mock('../src/Menu', () => ({ Dropdown: 'Dropdown' }))
vi.mock('@/components/settings-row', () => ({ SettingsGroupTitle: 'h4', SettingsRow: 'div', SettingsLabel: 'label' }))
vi.mock('@/components/desktop-button', () => ({ Button: 'Button' }))
vi.mock('@/components/desktop-input', () => ({ Input: 'Input' }))
vi.mock('@/components/ui/switch', () => ({ Switch: 'Switch' }))
vi.mock('@/components/ui/dialog', () => ({
  Dialog: 'Dialog',
  DialogContent: 'div',
  DialogDescription: 'p',
  DialogFooter: 'div',
  DialogHeader: 'div',
  DialogTitle: 'h3',
}))
vi.mock('../src/views/searchEngine', () => ({ SearchEnginePicker: 'SearchEnginePicker' }))
vi.mock('../src/settings/BrowserProfiles', () => ({ BrowserProfilesSettings: 'BrowserProfilesSettings' }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ fetchQuery: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === 'provider-settings' ? [] : { accounts: [], canAdminister: false },
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
}))
vi.mock('../src/settings/Usage', () => ({ useAccountUsage: () => ({}) }))
vi.mock('../src/settings/ProviderCard', () => ({ ProviderCard: 'ProviderCard' }))
vi.mock('../src/settings/ProviderModels', () => ({ ProviderModels: 'ProviderModels' }))
vi.mock('../src/models/ModelSets', () => ({ useModelSets: () => ({ catalogs: [] }) }))
vi.mock('../src/models/ProviderSetupTerminal', () => ({ runProviderCommand: state.runCommand }))
import { ProviderSettings } from '../src/settings/ProviderSettings'
import { BrowserSettings } from '../src/settings/BrowserSettings'
import { HostBrowserSettings } from '../src/settings/HostBrowserSettings'
type Node = { type?: unknown; props: Record<string, any> }
const nodes = (value: unknown): Node[] =>
  !value || typeof value !== 'object'
    ? []
    : [value as Node, ...[(value as Node).props?.children].flat(Infinity).flatMap(nodes)]
const RenderBrowser = () => {
  state.cursor = 0
  return BrowserSettings({ draft: DEFAULT_APP_PREFERENCES, onChange: state.change, busy: false })
}
const RenderHost = (readOnly = false, hostId = 'local') => {
  state.cursor = 0
  state.hostPanel = true
  return HostBrowserSettings({ hostId, readOnly, refreshed: async () => {}, onRemoved() {} })
}
beforeEach(() => {
  state.slots = []
  state.cursor = 0
  state.hostPanel = false
  state.scope = { primaryId: 'remote', target: 'remote', targets: [{ id: 'remote', viewOnly: false }] }
  vi.clearAllMocks()
  state.invoke.mockReset()
})
it('keeps device link/search/profile controls while disabling host browser preferences for viewers', () => {
  const before = nodes(RenderBrowser())
  const retained = before.find((node) => node.props?.label === 'Agent browser')!
  state.scope.targets[0]!.viewOnly = true
  const viewer = nodes(RenderBrowser())
  expect(viewer.find((node) => node.type === 'fieldset')!.props.disabled).toBe(true)
  expect(viewer.find((node) => node.type === HostBrowserSettings)!.props.readOnly).toBe(true)
  expect(viewer.some((node) => node.type === 'SearchEnginePicker')).toBe(true)
  expect(viewer.some((node) => node.type === 'BrowserProfilesSettings')).toBe(true)
  retained.props.onChange('provider')
  expect(state.change).not.toHaveBeenCalled()
  viewer.find((node) => node.props?.label === 'Open clicked links in')!.props.onChange('system')
  expect(state.localPreference).toHaveBeenCalled()
})
it.each(['viewer', 'host switch'])('refuses retained host-browser administration after a %s change', async (change) => {
  const before = nodes(RenderHost())
  const toggle = before.find((node) => node.type === 'Switch')!
  const refresh = before.find((node) => node.type === 'Button' && node.props.children === 'Refresh')!
  const after = nodes(RenderHost(change === 'viewer', change === 'viewer' ? 'local' : 'other'))
  if (change === 'viewer') expect(after.some((node) => node.props?.role === 'status')).toBe(true)
  toggle.props.onCheckedChange(false)
  refresh.props.onClick()
  await Promise.resolve()
  expect(state.invoke).not.toHaveBeenCalled()
})

it('does not launch a provider login terminal when access changes during command lookup', async () => {
  const RenderProviders = () => {
    state.cursor = 0
    return ProviderSettings({ value: DEFAULT_APP_PREFERENCES, onChange: state.change })
  }
  let finish!: (value: unknown) => void
  state.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const card = nodes(RenderProviders()).find((node) => node.type === 'ProviderCard')!
  card.props.onLogin('default')
  expect(state.invoke).toHaveBeenCalledWith('providers.loginCommand', expect.anything(), expect.anything())
  state.scope.targets[0]!.viewOnly = true
  const viewer = nodes(RenderProviders())
  expect(viewer.find((node) => node.type === 'fieldset')!.props.disabled).toBe(true)
  card.props.onChange({ binary: '/kept-draft' })
  finish({ command: 'login' })
  for (let i = 0; i < 6; i++) await Promise.resolve()
  expect(state.runCommand).not.toHaveBeenCalled()
  expect(state.change).not.toHaveBeenCalled()
  expect(state.invoke).toHaveBeenCalledTimes(1)
})
