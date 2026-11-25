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
vi.mock('../src/models/ModelSets', () => ({ useModelSets: () => ({}) }))
vi.mock('../src/chat/Notifications', () => ({ notifyError: state.notify }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text }))
vi.mock('../src/Menu', () => ({ Dropdown: 'Dropdown' }))
vi.mock('../src/settings/ModelChoice', () => ({ ModelChoice: 'ModelChoice' }))
vi.mock('@/components/settings-row', () => ({ SettingsGroupTitle: 'h4', SettingsRow: 'div', SettingsLabel: 'label' }))
vi.mock('@/components/desktop-button', () => ({ Button: 'Button' }))
vi.mock('@/components/ui/switch', () => ({ Switch: 'Switch' }))
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
  return LearningSettings({ value: DEFAULT_APP_PREFERENCES.intelligence, onChange() {}, memory: true })
}
const tidy = () =>
  nodes(RenderLearning()).find(
    (node) => node.type === 'Button' && ['Tidy up now', 'Tidying up…'].includes(node.props.children),
  )!
const flush = async () => {
  state.effects.splice(0).forEach((run) => run())
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
const snapshot = (running: boolean) => ({ jobs: [], skills: [], running })
beforeEach(() => {
  state.slots = []
  state.effects = []
  state.host = 'a'
  state.viewer = false
  state.invoke.mockReset().mockResolvedValue(snapshot(false))
  state.on.mockReset().mockReturnValue(() => {})
  state.notify.mockReset()
})
it('tidies up with one press: learning first, then memory cleanup', async () => {
  RenderLearning()
  await flush()
  state.invoke.mockClear()
  tidy().props.onClick()
  await flush()
  expect(state.invoke.mock.calls.map(([method]) => method)).toEqual(['learning.run', 'memory.dream', 'learning.get'])
})
it('disables tidying up for viewers and ignores a press retained from before', async () => {
  RenderLearning()
  await flush()
  const before = tidy()
  state.viewer = true
  expect(tidy().props.disabled).toBe(true)
  await flush()
  state.invoke.mockClear()
  before.props.onClick()
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
  expect(tidy().props.children).toBe('Tidy up now')
  state.invoke.mockResolvedValue(snapshot(true))
  await flush()
  finish(snapshot(false))
  await flush()
  expect(tidy().props.children).toBe('Tidying up…')
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
  state.invoke.mockResolvedValueOnce(snapshot(true))
  changed()
  await flush()
  finish(snapshot(false))
  await flush()
  expect(tidy().props.children).toBe('Tidying up…')
})
