import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as any[],
  effects: [] as (() => void)[],
  viewer: true,
  invoke: vi.fn(),
}))
vi.mock('../src/settings/DevicePermissions', () => ({ PermissionNeeded: 'permission', useMayUse: () => true }))
vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
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
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ id: 'host', invoke: state.invoke }) }))
vi.mock('../src/composer/useHostWriteAccess', () => {
  const canWrite = () => !state.viewer
  return { useHostWriteAccess: () => ({ viewOnly: state.viewer, canWrite }) }
})
vi.mock('../src/chat/useComputerVideo', () => ({ useComputerVideo: () => ({ status: 'idle' }) }))
vi.mock('../src/chat/ComputerSharing', () => ({ ComputerSharing: 'ComputerSharing' }))
vi.mock('../src/composer/ComposerTraySection', () => ({ ComposerTraySection: 'section' }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text, useLanguage() {} }))
vi.mock('../src/settings/AppSettings', () => ({ useAppSettings: () => ({ preferences: { liveViewDesktop: true } }) }))
vi.mock('../src/liveView/liveViewStore', () => ({ floatLiveView: vi.fn() }))
vi.mock('../src/Menu', () => ({ Dropdown: 'Dropdown', Menu: 'Menu' }))
vi.mock('@/components/desktop-button', () => ({ Button: 'Button' }))
vi.mock('@/components/desktop-input', () => ({ Input: 'Input' }))
vi.mock('@/components/ui/dialog', () => ({
  Dialog: 'Dialog',
  DialogContent: 'div',
  DialogDescription: 'p',
  DialogHeader: 'div',
  DialogTitle: 'h3',
}))
import { ComputerActivity, ComputerGrantDialog, useComputerActivity } from '../src/chat/ComputerActivity'
type Node = { type?: unknown; props: Record<string, any> }
const nodes = (value: unknown): Node[] =>
  !value || typeof value !== 'object'
    ? []
    : [value as Node, ...[(value as Node).props?.children].flat(Infinity).flatMap(nodes)]
const session = {
  generation: 1,
  target: { kind: 'display', id: 'display', name: 'Granted display' },
  runtime: { id: 'local' },
  controller: { kind: 'human' },
  handoffRequest: { deviceId: 'other' },
}
// Mirrors AgentView: the hook feeds both the tray row and the grant dialog in one render.
const Render = () => {
  state.cursor = 0
  const activity = useComputerActivity('task', true)
  return { tray: ComputerActivity({ state: activity }), dialog: ComputerGrantDialog({ state: activity }) }
}
const RenderActivity = () => Render().tray
const listeners = () =>
  (window.addEventListener as ReturnType<typeof vi.fn>).mock.calls
    .filter(([name]) => name === 'ramu:open-computer')
    .map(([, listener]) => listener as (event: unknown) => void)
const askToOpen = () => listeners().forEach((listener) => listener({ detail: { taskId: 'task' } }))
const flush = async () => {
  state.effects.splice(0).forEach((run) => run())
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
beforeEach(() => {
  vi.useFakeTimers()
  ;(window.addEventListener as ReturnType<typeof vi.fn>).mockClear()
  state.slots = []
  state.effects = []
  state.viewer = true
  state.invoke.mockReset().mockImplementation(async (method) => {
    if (method === 'computer.session') return session
    if (method === 'computer.status') return { enabled: true, runtime: { available: true } }
    if (method === 'computer.runtimes') return []
    if (method === 'computer.frame')
      return { data: 'AA', mimeType: 'image/png', width: 10, height: 10, capturedAt: Date.now(), generation: 1 }
  })
})
afterEach(() => {
  state.viewer = true
  for (const slot of state.slots) slot?.cleanup?.()
  vi.useRealTimers()
})
it('loads a granted viewer session without administrative reads and offers only viewing', async () => {
  RenderActivity()
  await flush()
  const tree = nodes(RenderActivity())
  expect(state.invoke.mock.calls.map(([method]) => method)).toEqual(['computer.session'])
  expect(tree.some((node) => node.props.children === 'View computer')).toBe(true)
  for (const label of ['Take control', 'Give control to agent', 'Stop computer use', 'Revoke access'])
    expect(tree.some((node) => node.props.children === label)).toBe(false)
  expect(tree.some((node) => node.type === 'ComputerSharing')).toBe(false)
})
it('keeps frame viewing but removes input and handoff controls inside the viewer', async () => {
  RenderActivity()
  await flush()
  nodes(RenderActivity())
    .find((node) => node.props.children === 'View computer')!
    .props.onClick()
  const viewer = nodes(RenderActivity()).find((node) => typeof node.type === 'function' && node.type.name === 'Viewer')!
  for (const slot of state.slots) slot?.cleanup?.()
  state.slots = []
  state.effects = []
  const RenderViewer = () => {
    state.cursor = 0
    return (viewer.type as (props: Record<string, unknown>) => unknown)(viewer.props)
  }
  RenderViewer()
  await flush()
  const tree = nodes(RenderViewer())
  expect(tree.some((node) => node.type === 'img')).toBe(true)
  expect(tree.some((node) => node.type === 'Input')).toBe(false)
  expect(tree.some((node) => typeof node.type === 'function' && node.type.name === 'HandoffNotice')).toBe(false)
  expect(tree.some((node) => node.props.children === 'Take control')).toBe(false)
  expect(state.invoke.mock.calls.every(([method]) => ['computer.session', 'computer.frame'].includes(method))).toBe(
    true,
  )
})
it('refuses a retained stop action after viewer access is confirmed', async () => {
  state.viewer = false
  RenderActivity()
  await flush()
  // Stopping the agent lives in the computer's ⋯ menu.
  const menu = nodes(RenderActivity()).find((node) => node.type === 'Menu')!
  const stop = menu.props.items.find((item: { key: string }) => item.key === 'stop-agent')
  state.viewer = true
  RenderActivity()
  state.invoke.mockClear()
  stop.onSelect()
  await flush()
  expect(state.invoke.mock.calls.some(([method]) => method === 'computer.stop')).toBe(false)
})
it('stays out of the tray while the thread has no computer, and opens the grant dialog when asked', async () => {
  state.viewer = false
  state.invoke.mockImplementation(async (method) => {
    if (method === 'computer.session') return null
    if (method === 'computer.status') return { enabled: true, runtime: { available: true }, apps: { available: false } }
    if (method === 'computer.runtimes') return []
  })
  Render()
  await flush()
  const idle = Render()
  expect(idle.tray).toBeNull()
  expect((idle.dialog as Node).props.open).toBe(false)
  askToOpen()
  Render()
  await flush()
  const asked = nodes(Render().dialog)
  expect(asked[0]!.props.open).toBe(true)
  const allow = asked.find((node) => node.props.children === 'Allow main display')!
  allow.props.onClick()
  await flush()
  expect(state.invoke).toHaveBeenCalledWith('computer.grant', 'task', { observe: true, input: true, runtime: 'local' })
})
it('does not offer a grant to a view-only device', async () => {
  state.invoke.mockImplementation(async (method) => (method === 'computer.session' ? null : undefined))
  Render()
  await flush()
  askToOpen()
  const viewOnly = Render()
  expect(viewOnly.tray).toBeNull()
  expect((viewOnly.dialog as Node).props.open).toBe(false)
})
