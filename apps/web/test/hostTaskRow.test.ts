import { createElement, isValidElement, type ReactNode, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type Task } from '@ramu/shared/types'
import { GitFork } from 'lucide-react'
import { TaskRow } from '../src/sidebar/projects/TaskRow'

const state = vi.hoisted(() => ({
  ownInvoke: vi.fn(),
  hostInvoke: vi.fn(),
  hostRefresh: vi.fn(),
  forget: vi.fn(),
  open: vi.fn(),
  select: vi.fn(),
  host: { id: 'remote', status: 'connected' as string },
  store: null as Record<string, unknown> | null,
  menu: [] as { key?: string; disabled?: boolean }[],
}))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => [initial, vi.fn()],
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect() {},
}))
vi.mock('../src/sidebar/projects/ThreadSelectionBar', () => ({ useBulkActionsContext: () => null }))
vi.mock('../src/sidebar/projects/threadSelection', () => ({
  threadSelection: { toggle: vi.fn(), range: vi.fn(), clear: vi.fn() },
  useThreadSelection: () => new Set<string>(),
}))
vi.mock('../src/i18n', () => ({ useLanguage() {}, t: (text: string) => text }))
vi.mock('../src/ipc', () => ({ invoke: state.ownInvoke, copyText: vi.fn() }))
vi.mock('../src/workspace/computers', () => ({ useComputers: () => null }))
vi.mock('../src/workspace/HostProvider', () => ({
  useHost: () => ({ ...state.host, isLocal: state.host.id === 'local', invoke: state.hostInvoke }),
}))
vi.mock('../src/workspace/HostSelection', () => ({
  useHostSelection: () => ({ activeHost: 'local', select: state.select }),
}))
vi.mock('../src/workspace/workspace', () => ({ useRowStore: () => state.store }))
vi.mock('../src/models/ModelSets', () => ({ useModelSets: () => ({ initialSettings: DEFAULT_AGENT_SETTINGS }) }))
vi.mock('../src/Menu', () => ({
  useContextMenu: (_name: string, items: typeof state.menu) => {
    state.menu = items
    return {}
  },
  Dialog: () => null,
}))
vi.mock('../src/workspace/TaskPane', () => ({ errorText: String }))
vi.mock('../src/chat/Notifications', () => ({ notifyError: vi.fn() }))
vi.mock('../src/sidebar/projects/TaskStateIcon', () => ({
  TaskStateIcon: () => null,
  TaskAge: () => createElement('span', {}, 'time'),
}))
vi.mock('@/components/desktop-button', () => ({ Button: 'button' }))
vi.mock('../src/sidebar/projects/AgentStack', () => ({ AgentStack: () => createElement('span', {}, 'agent-icon') }))
vi.mock('../src/FadeText', () => ({ FadeText: ({ text }: { text: string }) => createElement('span', {}, text) }))

const task: Task = {
  id: 'same-id',
  title: 'Remote thread',
  projectId: 'p',
  mode: 'current',
  workspaceId: null,
  status: 'idle',
  createdAt: 1,
  lastActiveAt: 1,
  pinnedAt: null,
}
// The other host's store: it happens to have a thread with the same id as the one open on screen.
const remoteStore = () => ({
  tasks: [task],
  workspaces: [],
  bindings: {},
  ui: { activeTaskId: 'same-id', openTaskIds: ['same-id'] },
  composing: null,
  refresh: state.hostRefresh,
  forgetTask: state.forget,
  openTask: state.open,
  unread: new Set(['same-id']),
})
const elements = (node: ReactNode): ReactElement<Record<string, unknown>>[] => {
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...[node.props.children].flat(Infinity).flatMap((child) => elements(child as ReactNode))]
}
beforeEach(() => {
  vi.clearAllMocks()
  state.host = { id: 'remote', status: 'connected' }
  state.store = remoteStore()
  state.hostInvoke.mockResolvedValue(task)
  state.hostRefresh.mockResolvedValue(undefined)
})

it('opens another host’s row through the selection and never highlights a colliding task ID', () => {
  const tree = TaskRow({ task })
  const row = elements(tree).find((node) => node.props.role === 'button')!
  expect(row.props.className).not.toContain(' active')
  ;(row.props.onClick as () => void)()
  expect(state.select).toHaveBeenCalledWith('remote', { kind: 'task', taskId: 'same-id' })
  expect(state.open).not.toHaveBeenCalled()
})

it('opens a row of the host on screen in its store directly', () => {
  state.host = { id: 'local', status: 'connected' }
  const row = elements(TaskRow({ task })).find((node) => node.props.role === 'button')!
  expect(row.props.className).toContain(' active')
  ;(row.props.onClick as () => void)()
  expect(state.open).toHaveBeenCalledWith('same-id')
  expect(state.select).not.toHaveBeenCalled()
})

it('runs pin and done with the row host’s own invoke and refreshes only that host’s store', async () => {
  const buttons = elements(TaskRow({ task }))
  const pin = buttons.find((node) => node.props['aria-label'] === 'Pin thread')!
  ;(pin.props.onClick as (e: { stopPropagation(): void }) => void)({ stopPropagation() {} })
  await vi.waitFor(() => expect(state.hostRefresh).toHaveBeenCalled())
  expect(state.hostInvoke).toHaveBeenCalledWith('tasks.pin', 'same-id', true)
  const done = buttons.find((node) => node.props['aria-label'] === 'Mark thread done')!
  ;(done.props.onClick as (e: { stopPropagation(): void }) => void)({ stopPropagation() {} })
  await vi.waitFor(() => expect(state.hostInvoke).toHaveBeenCalledWith('tasks.done', 'same-id', true))
  expect(state.ownInvoke).not.toHaveBeenCalled()
  expect(state.forget).not.toHaveBeenCalled()
})

it('keeps offline rows visible and makes their actions unavailable', () => {
  state.host = { id: 'remote', status: 'offline' }
  const tree = TaskRow({ task })
  const row = elements(tree).find((node) => node.props.role === 'button')!
  ;(row.props.onClick as () => void)()
  expect(state.select).not.toHaveBeenCalled()
  expect(row.props['aria-disabled']).toBe(true)
  expect(elements(tree).find((node) => node.props['aria-label'] === 'Pin thread')!.props.disabled).toBe(true)
  expect(renderToStaticMarkup(tree)).toContain('Remote thread')
})

it('offers a shared-workspace rename only for a known workspace on its connected host', () => {
  const isolated = { ...task, mode: 'worktree' as const, workspaceId: 'w' }
  state.store = { ...remoteStore(), workspaces: [{ id: 'w', projectId: 'p', name: 'Shared checkout' }] }
  TaskRow({ task: isolated })
  expect(state.menu.find((entry) => entry.key === 'rename-workspace')?.disabled).toBe(false)
  state.host.status = 'offline'
  TaskRow({ task: isolated })
  expect(state.menu.find((entry) => entry.key === 'rename-workspace')?.disabled).toBe(true)
  state.host = { id: 'local', status: 'offline' }
  TaskRow({ task: isolated })
  expect(state.menu.find((entry) => entry.key === 'rename-workspace')?.disabled).toBe(true)
  state.store = remoteStore()
  TaskRow({ task: isolated })
  expect(state.menu.find((entry) => entry.key === 'rename-workspace')).toBeUndefined()
})

it('shows last known rows of a host whose store has not loaded, without actions', () => {
  state.store = null
  const tree = TaskRow({ task })
  const row = elements(tree).find((node) => node.props.role === 'button')!
  ;(row.props.onClick as () => void)()
  expect(state.select).not.toHaveBeenCalled()
  expect(row.props['aria-disabled']).toBe(true)
  expect(renderToStaticMarkup(tree)).toContain('Remote thread')
})

it('adds a context line only when there is a project or branch to name', () => {
  const lines = (tree: ReactNode) =>
    elements(tree).filter((node) => String(node.props.className).startsWith('task-context'))
  // A thread with nothing to name stays one line, as short as before.
  const plain = TaskRow({ task })
  expect(lines(plain)).toHaveLength(0)
  expect(elements(plain).find((node) => node.props.role === 'button')!.props.className).toContain('min-h-[30px]')
  const branched = { ...task, branch: 'ramu/fix-login' }
  const tree = TaskRow({ task: branched, projectName: 'Shop' })
  expect(lines(tree)).toHaveLength(1)
  expect(elements(tree).find((node) => node.props.role === 'button')!.props.className).toContain('min-h-11')
  expect(renderToStaticMarkup(tree)).toMatch(/Remote thread.*Shop.*ramu\/fix-login/)
  // Inside a project's group the branch line is optional.
  expect(lines(TaskRow({ task: branched, hideBranch: true }))).toHaveLength(0)
})

it('names the branch an open thread’s bindings report when the host list has none', () => {
  state.store = {
    ...remoteStore(),
    bindings: { 'same-id': [{ folderOnly: false, taskBranch: null, checkedOut: 'main' }] },
  }
  expect(renderToStaticMarkup(TaskRow({ task }))).toContain('>main<')
})

it('keeps every icon in one group at the right edge: under the time on two-line rows, after it on one-line rows', () => {
  const finished = {
    ...task,
    doneAt: 5,
    branch: 'main',
    startedFrom: { groupId: 'g', taskId: 'parent', title: 'Parent' },
  }
  const tree = TaskRow({ task: finished, projectName: 'Shop' })
  const context = elements(tree).find((node) => String(node.props.className).startsWith('task-context'))!
  const head = elements(tree).find((node) => String(node.props.className).startsWith('task-head'))!
  expect(renderToStaticMarkup(context)).toContain('agent-icon')
  expect(renderToStaticMarkup(head)).not.toContain('agent-icon')
  expect(elements(context).some((node) => node.type === GitFork)).toBe(true)
  // A one-line row ends with one icon group (marks, then agents) after the time, on the same right edge as the
  // context line of a two-line row.
  const plain = TaskRow({ task: { ...task, startedFrom: finished.startedFrom } })
  const line = renderToStaticMarkup(
    elements(plain).find((node) => String(node.props.className).startsWith('task-head'))!,
  )
  expect(line).toMatch(/time<\/span><span class="task-trailing[^"]*">.*<span>agent-icon<\/span><\/span><\/span>$/)
  expect(line.indexOf('time</span>')).toBeLessThan(line.indexOf('task-trailing'))
})
