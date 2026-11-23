import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
const state = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as any[],
  effects: [] as (() => void)[],
  host: 'a',
  viewer: false,
  invoke: vi.fn(),
  on: vi.fn(),
  notify: vi.fn(),
}))
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useContext: () => ({ primaryId: state.host, targets: [{ viewOnly: state.viewer }] }),
  useRef: (value: unknown) => (state.slots[state.cursor++] ??= { current: value }),
  useState: (value: unknown) => {
    const index = state.cursor++
    if (!(index in state.slots)) state.slots[index] = value
    return [
      state.slots[index],
      (next: unknown) => {
        state.slots[index] = typeof next === 'function' ? next(state.slots[index]) : next
      },
    ]
  },
  useCallback: (run: unknown, deps: unknown[]) => {
    const index = state.cursor++,
      previous = state.slots[index]
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) state.slots[index] = { deps, value: run }
    return state.slots[index].value
  },
  useEffect: (run: () => void | (() => void), deps: unknown[]) => {
    const index = state.cursor++,
      previous = state.slots[index]
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i]))
      state.effects.push(() => {
        previous?.cleanup?.()
        state.slots[index] = { deps, cleanup: run() }
      })
  },
}))
vi.mock('../src/settings/SettingsScope', async () => ({
  SettingsScopeContext: (await import('react')).createContext(null),
  useSettingsInvoke: () => state.invoke,
  useSettingsEvents: () => state.on,
}))
vi.mock('../src/settings/InstalledSkills', () => ({ InstalledSkills: () => null }))
vi.mock('../src/settings/cards', () => ({
  SettingsCard: 'SettingsCard',
  SettingsCardList: 'SettingsCardList',
  usePaged: (shown: unknown[]) => ({ shown, more: null }),
}))
vi.mock('../src/SearchInput', () => ({ SearchInput: 'SearchInput' }))
vi.mock('../src/models/ModelSets', () => ({ useModelSets: () => ({}) }))
vi.mock('../src/summaries/libraryFocus', () => ({ takeLibraryFocus: () => null }))
vi.mock('../src/chat/MarkdownText', () => ({ MarkdownText: 'MarkdownText' }))
vi.mock('../src/chat/Notifications', () => ({ notifyError: state.notify }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text }))
vi.mock('../src/Menu', () => ({ Dropdown: 'Dropdown' }))
vi.mock('../src/settings/ModelChoice', () => ({ ModelChoice: 'ModelChoice' }))
vi.mock('@/components/settings-row', () => ({ SettingsGroupTitle: 'h4', SettingsRow: 'div', SettingsLabel: 'label' }))
vi.mock('@/components/desktop-button', () => ({ Button: 'Button' }))
vi.mock('@/components/ui/switch', () => ({ Switch: 'Switch' }))
vi.mock('@/components/ui/badge', () => ({ Badge: 'Badge' }))
import { LearningSettings } from '../src/settings/IntelligenceSettings'
type Node = { type?: unknown; props: Record<string, any> }
const nodes = (value: unknown): Node[] =>
  !value || typeof value !== 'object'
    ? []
    : [
        value as Node,
        ...[(value as Node).props?.children, (value as Node).props?.actions].flat(Infinity).flatMap(nodes),
      ]
const RenderLearning = () => {
  state.cursor = 0
  return LearningSettings({ value: DEFAULT_APP_PREFERENCES.intelligence, onChange() {} })
}
const flush = async () => {
  state.effects.splice(0).forEach((run) => run())
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
const snapshot = (title: string) => ({
  jobs: [{ id: 'job', status: 'pending', createdAt: 1, sessionTitle: title }],
  skills: [],
  running: false,
})
beforeEach(() => {
  state.slots = []
  state.effects = []
  state.host = 'a'
  state.viewer = false
  state.invoke.mockReset().mockResolvedValue(snapshot('Host A'))
  state.on.mockReset().mockReturnValue(() => {})
  state.notify.mockReset()
})
it('keeps cached reviews readable while disabling maintenance and retained apply actions for viewers', async () => {
  RenderLearning()
  await flush()
  const before = nodes(RenderLearning())
  const apply = before.find((node) => node.type === 'Button' && node.props.children === 'Apply')!
  const maintenance = before.find(
    (node) => node.type === 'Button' && node.props.children === 'Run learning maintenance',
  )!
  state.viewer = true
  const viewer = nodes(RenderLearning())
  await flush()
  expect(viewer.some((node) => String(node.props.title ?? '').includes('Host A'))).toBe(true)
  expect(viewer.find((node) => node.type === 'Button' && node.props.children === 'Apply')!.props.disabled).toBe(true)
  state.invoke.mockClear()
  apply.props.onClick()
  maintenance.props.onClick()
  await flush()
  expect(state.invoke).not.toHaveBeenCalled()
})
it('hides another host snapshot immediately and ignores its late response', async () => {
  let finish!: (value: unknown) => void
  state.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  RenderLearning()
  await flush()
  state.host = 'b'
  expect(nodes(RenderLearning()).some((node) => node.type === 'SettingsCard')).toBe(false)
  state.invoke.mockResolvedValue(snapshot('Host B'))
  await flush()
  finish(snapshot('Old host A'))
  await flush()
  const selected = nodes(RenderLearning())
  expect(selected.some((node) => String(node.props.title ?? '').includes('Host B'))).toBe(true)
  expect(selected.some((node) => String(node.props.title ?? '').includes('Old host A'))).toBe(false)
  expect(state.notify).not.toHaveBeenCalled()
})

it('keeps the newest refresh when same-host memory events complete out of order', async () => {
  RenderLearning()
  await flush()
  RenderLearning()
  const changed = state.on.mock.calls[0]![1] as () => void
  let finish!: (value: unknown) => void
  state.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  changed()
  state.invoke.mockResolvedValueOnce(snapshot('Newest review'))
  changed()
  await flush()
  finish(snapshot('Stale review'))
  await flush()
  const selected = nodes(RenderLearning())
  expect(selected.some((node) => String(node.props.title ?? '').includes('Newest review'))).toBe(true)
  expect(selected.some((node) => String(node.props.title ?? '').includes('Stale review'))).toBe(false)
})
