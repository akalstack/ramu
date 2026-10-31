import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as any[],
  effects: [] as (() => void)[],
  viewer: true,
  invoke: vi.fn(),
}))
vi.mock('../src/settings/DevicePermissions', () => ({ PermissionNeeded: 'permission', useMayUse: () => true }))
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
import { ComputerActivity } from '../src/chat/ComputerActivity'
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
const RenderActivity = () => {
  state.cursor = 0
  return ComputerActivity({ taskId: 'task', visible: true })
}
const flush = async () => {
  state.effects.splice(0).forEach((run) => run())
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
beforeEach(() => {
  vi.useFakeTimers()
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
