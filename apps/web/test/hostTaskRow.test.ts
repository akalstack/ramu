import { createElement, isValidElement, type ReactNode, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type Task } from '@ramu/shared/types'
import { TaskRow } from '../src/sidebar/projects/TaskRow'

const state = vi.hoisted(() => ({
  invoke: vi.fn(),
  hostInvoke: vi.fn(),
  refresh: vi.fn(),
  hostRefresh: vi.fn(),
  forget: vi.fn(),
  open: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => [initial, vi.fn()],
}))
vi.mock('../src/i18n', () => ({ useLanguage() {}, t: (text: string) => text }))
vi.mock('../src/ipc', () => ({ invoke: state.invoke, ramu: { invoke: state.hostInvoke }, copyText: vi.fn() }))
vi.mock('../src/workspace/computers', () => ({ useComputers: () => null }))
vi.mock('../src/workspace/hostOverview', () => ({ navigateHost: state.navigate }))
vi.mock('../src/workspace/workspace', () => ({
  useWorkspace: () => ({
    tasks: [],
    workspaces: [],
    ui: { activeTaskId: 'same-id', openTaskIds: ['same-id'] },
    composing: null,
    refresh: state.refresh,
    forgetTask: state.forget,
    openTask: state.open,
    unread: new Set(['same-id']),
  }),
}))
vi.mock('../src/models/ModelSets', () => ({ useModelSets: () => ({ initialSettings: DEFAULT_AGENT_SETTINGS }) }))
vi.mock('../src/Menu', () => ({ useContextMenu: () => ({}), Dialog: () => null }))
vi.mock('../src/workspace/TaskPane', () => ({ errorText: String }))
vi.mock('../src/chat/Notifications', () => ({ notifyError: vi.fn() }))
vi.mock('../src/sidebar/projects/TaskStateIcon', () => ({ TaskStateIcon: () => null }))
vi.mock('@/components/desktop-button', () => ({ Button: 'button' }))
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
const remote = { id: 'remote', tasks: [task], available: true, refresh: state.hostRefresh }
const elements = (node: ReactNode): ReactElement<Record<string, unknown>>[] => {
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...[node.props.children].flat(Infinity).flatMap((child) => elements(child as ReactNode))]
}
beforeEach(() => {
  vi.clearAllMocks()
  state.hostInvoke.mockResolvedValue(task)
  state.hostRefresh.mockResolvedValue(undefined)
})

it('opens a remote row on its own host and never highlights a colliding local task ID', () => {
  const tree = TaskRow({ task, remote })
  const row = elements(tree).find((node) => node.props.role === 'button')!
  expect(row.props.className).not.toContain(' active')
  ;(row.props.onClick as () => void)()
  expect(state.navigate).toHaveBeenCalledWith('remote', { kind: 'task', taskId: 'same-id' })
  expect(state.open).not.toHaveBeenCalled()
})

it('routes pin and done controls to the remote host and refreshes only that host', async () => {
  const buttons = elements(TaskRow({ task, remote }))
  const pin = buttons.find((node) => node.props['aria-label'] === 'Pin thread')!
  ;(pin.props.onClick as (e: { stopPropagation(): void }) => void)({ stopPropagation() {} })
  await vi.waitFor(() => expect(state.hostRefresh).toHaveBeenCalled())
  expect(state.hostInvoke).toHaveBeenCalledWith('computers.tasks.invoke', 'remote', 'tasks.pin', ['same-id', true])
  const done = buttons.find((node) => node.props['aria-label'] === 'Mark thread done')!
  ;(done.props.onClick as (e: { stopPropagation(): void }) => void)({ stopPropagation() {} })
  await vi.waitFor(() =>
    expect(state.hostInvoke).toHaveBeenCalledWith('computers.tasks.invoke', 'remote', 'tasks.done', ['same-id', true]),
  )
  expect(state.invoke).not.toHaveBeenCalled()
  expect(state.refresh).not.toHaveBeenCalled()
  expect(state.forget).not.toHaveBeenCalled()
})

it('keeps offline rows visible and makes their actions unavailable', () => {
  const tree = TaskRow({ task, remote: { ...remote, available: false } })
  const row = elements(tree).find((node) => node.props.role === 'button')!
  ;(row.props.onClick as () => void)()
  expect(state.navigate).not.toHaveBeenCalled()
  expect(row.props['aria-disabled']).toBe(true)
  expect(elements(tree).find((node) => node.props['aria-label'] === 'Pin thread')!.props.disabled).toBe(true)
  expect(renderToStaticMarkup(tree)).toContain('Remote thread')
})
