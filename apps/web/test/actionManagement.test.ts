import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ProjectAction, ProjectActionSettings } from '@ramu/shared/types'
const state = vi.hoisted(() => ({
  host: 'a',
  status: 'connected',
  invoke: vi.fn(),
  openView: vi.fn(),
  visible: [] as ProjectAction[],
  settings: {} as ProjectActionSettings & { supported: boolean; loading: boolean; error: string },
  current: {} as { values: unknown[]; refs: { current: unknown }[] },
  index: 0,
  refIndex: 0,
}))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState(initial: unknown) {
    const index = state.index++
    if (!(index in state.current.values))
      state.current.values[index] = typeof initial === 'function' ? initial() : initial
    return [
      state.current.values[index],
      (value: unknown) => {
        state.current.values[index] = value
      },
    ]
  },
  useRef(initial: unknown) {
    return (state.current.refs[state.refIndex++] ??= { current: initial })
  },
  // The component is called as a plain function here; effects have nothing to run against.
  useEffect() {},
}))
vi.mock('../src/i18n', () => ({
  useLanguage() {},
  t: (value: string, args?: Record<string, string>) => (args ? value.replace('{0}', args['0']!) : value),
}))
vi.mock('../src/workspace/HostProvider', () => ({
  useHost: () => ({ id: state.host, status: state.status, invoke: state.invoke }),
}))
vi.mock('../src/workspace/workspace', () => ({ useWorkspace: () => ({ openView: state.openView }) }))
vi.mock('../src/workspace/useProjectActions', () => ({
  PROJECT_ACTIONS_EVENT: 'ramu:project-actions',
  useProjectActions: () => state.visible,
}))
vi.mock('../src/workspace/useProjectActionSettings', () => ({ useProjectActionSettings: () => state.settings }))
vi.mock('../src/hostStorage', () => ({ hostStorageFor: () => ({ getItem: () => null }) }))
vi.mock('../src/commands', () => ({ formatKeys: (value: string) => value }))
vi.mock('../src/Menu', () => ({ Menu: 'menu' }))
vi.mock('../src/workspace/TaskPane', () => ({ errorText: (error: Error) => error.message }))
vi.mock('../src/components/desktop-button', () => ({ Button: 'button' }))
vi.mock('@/components/desktop-button', () => ({ Button: 'button' }))
vi.mock('@/components/ui/dialog', () => ({ Dialog: 'dialog', DialogContent: 'content', DialogTitle: 'title' }))
vi.mock('@dnd-kit/core', () => ({
  DndContext: 'dnd',
  PointerSensor: 'pointer',
  KeyboardSensor: 'keyboard',
  closestCenter() {},
  useSensor() {},
  useSensors: () => [],
}))
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: 'sortable',
  sortableKeyboardCoordinates() {},
  verticalListSortingStrategy() {},
  useSortable() {},
}))
import { WindowActions } from '../src/WindowActions'
const hooks = new Map<unknown, typeof state.current>()
function render(component: unknown, props: unknown): ReactNode {
  state.current = hooks.get(component) ?? { values: [], refs: [] }
  hooks.set(component, state.current)
  state.index = state.refIndex = 0
  return (component as (props: unknown) => ReactNode)(props)
}
interface TestElement {
  type: unknown
  key: unknown
  props: {
    children?: ReactNode
    'aria-label'?: string
    disabled?: boolean
    onClick: () => void
    items: { key: string; onSelect: () => void }[]
  }
}
function nodes(node: ReactNode): TestElement[] {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [node as unknown as TestElement, ...nodes(node.props.children)]
}
function control() {
  const row = render(WindowActions, { ctx: 'project:p', projectId: 'p' })
  const component = nodes(row).find(
    (entry) => typeof entry.type === 'function' && entry.type.name === 'ActionsControl',
  )!
  return render(component.type, component.props)
}
function manager() {
  const entry = nodes(control()).find(
    (entry) => typeof entry.type === 'function' && entry.type.name === 'ManageDialog',
  )!
  return render(entry.type, entry.props)
}
const button = (tree: ReactNode, label: string) =>
  nodes(tree).find(
    (entry) => entry.type === 'button' && (entry.props['aria-label'] === label || entry.props.children === label),
  )!
const a = { id: 'a', name: 'Test', command: 'echo test', source: 'ramu.json' as const }
const b = { id: 'b', name: 'Dev', command: 'echo dev', source: 'ramu.json' as const }
afterEach(() => vi.unstubAllGlobals())
beforeEach(() => {
  hooks.clear()
  state.host = 'a'
  state.status = 'connected'
  state.invoke.mockReset()
  state.openView.mockReset()
  state.visible = []
  state.settings = {
    actions: [a, b],
    hiddenIds: ['a', 'b'],
    customOrder: false,
    supported: true,
    loading: false,
    error: '',
  }
  vi.stubGlobal('window', new EventTarget())
})
it('keeps management reachable when every action is hidden and restores without launching a terminal', async () => {
  button(control(), 'Manage actions').props.onClick()
  const tree = manager()
  const show = nodes(tree).filter(
    (entry) =>
      entry.type === 'button' && Array.isArray(entry.props.children) && entry.props.children.includes('Show action'),
  )[0]!
  state.invoke.mockResolvedValue(state.settings)
  show.props.onClick()
  show.props.onClick()
  expect(state.invoke).toHaveBeenCalledExactlyOnceWith('projects.setActionVisibility', 'p', 'a', false)
  await Promise.resolve()
  expect(state.openView).not.toHaveBeenCalled()
})
it('reorders only IDs and never submits stale repository commands or runs hidden actions', async () => {
  state.visible = [a, b]
  state.settings = { ...state.settings, hiddenIds: [], customOrder: true }
  // Open management from the split menu without invoking its command button.
  const menu = nodes(control()).find((entry) => typeof entry.type === 'function' && entry.type.name === 'SplitButton')!
  menu.props.items.find((item) => item.key === 'manage')!.onSelect()
  const tree = manager()
  state.invoke.mockResolvedValue(state.settings)
  button(tree, 'Move Test down').props.onClick()
  expect(state.invoke).toHaveBeenCalledExactlyOnceWith('projects.reorderActions', 'p', ['b', 'a'])
  await Promise.resolve()
  state.invoke.mockClear()
  button(manager(), 'Use repository order').props.onClick()
  expect(state.invoke).toHaveBeenCalledExactlyOnceWith('projects.resetActionOrder', 'p')
  expect(state.openView).not.toHaveBeenCalled()
})
it('disables unsupported and offline controls and scopes the entire editor to its host and checkout', () => {
  state.visible = []
  state.settings = { ...state.settings, supported: false, error: 'Actions refused', actions: [] }
  button(control(), 'Manage actions').props.onClick()
  expect(nodes(manager()).some((entry) => entry.props.children === 'Actions refused')).toBe(true)
  const first = nodes(render(WindowActions, { ctx: 'project:p', projectId: 'p' })).find(
    (entry) => typeof entry.type === 'function',
  )!
  state.host = 'b'
  const next = nodes(render(WindowActions, { ctx: 'project:p', projectId: 'p' })).find(
    (entry) => typeof entry.type === 'function',
  )!
  expect(next.key).not.toBe(first.key)
  state.status = 'disconnected'
  state.settings = { ...state.settings, supported: true, error: '', actions: [a, b], hiddenIds: [] }
  button(control(), 'Manage actions').props.onClick()
  const tree = manager()
  expect(button(tree, 'Hide Test').props.disabled).toBe(true)
  button(tree, 'Hide Test').props.onClick()
  expect(state.invoke).not.toHaveBeenCalled()
})
