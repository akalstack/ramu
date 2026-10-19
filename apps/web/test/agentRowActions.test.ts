import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AgentSessionInfo, Task } from '@ramu/shared/types'
import { DEFAULT_AGENT_SETTINGS } from '@ramu/shared/types'
import { AgentRow } from '../src/HomeAgents'

const state = vi.hoisted(() => ({
  task: { id: 'thread', title: 'A finished thread', doneAt: null, status: 'idle', workspaceId: null } as Task,
  hostStatus: 'connected',
  cards: [] as Record<string, unknown>[],
  invoke: vi.fn(),
  refresh: vi.fn(),
  forgetTask: vi.fn(),
  notifyError: vi.fn(),
  buttons: [] as ComponentProps<'button'>[],
}))
vi.mock('../src/i18n', () => ({ useLanguage: () => {}, t: (text: string) => text }))
vi.mock('../src/ipc', () => ({ invoke: state.invoke }))
vi.mock('../src/workspace/HostProvider', () => ({
  useHost: () => ({ id: 'local', status: state.hostStatus, invoke: state.invoke }),
}))
vi.mock('../src/workspace/workspace', () => ({
  useWorkspace: () => ({
    tasks: [state.task],
    projects: [],
    workspaces: [{ id: 'checkout', name: 'Feature checkout' }],
    unread: new Set(),
    refresh: state.refresh,
    forgetTask: state.forgetTask,
  }),
}))
vi.mock('@/components/desktop-button', () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<'button'> & { variant?: string; size?: string }) => {
    state.buttons.push(props)
    return createElement('button', props)
  },
}))
vi.mock('../src/sidebar/projects/ThreadHoverCard', () => ({
  ThreadHoverCard: (props: Record<string, unknown>) => {
    state.cards.push(props)
    return null
  },
}))
vi.mock('../src/chat/Notifications', () => ({ notifyError: state.notifyError }))
vi.mock('../src/Menu', () => ({ timeAgo: () => '' }))
vi.mock('../src/models/ProviderWait', () => ({ ProviderWaitIcon: () => null }))
vi.mock('../src/sidebar/projects/TaskStateIcon', () => ({ StateDot: () => null }))
vi.mock('../src/views/agent/hooks/useAgentStream', () => ({ useAgentStream: () => ({ events: [] }) }))
vi.mock('../src/chat/QuestionCard', () => ({ QuestionDock: () => null }))
vi.mock('../src/chat/ElicitationCard', () => ({ ElicitationCard: () => null }))
vi.mock('../src/views/agent/components/PermissionRequestCard', () => ({ PermissionRequestCard: () => null }))

const session: AgentSessionInfo = {
  id: 'session',
  taskId: 'thread',
  state: 'idle',
  settings: DEFAULT_AGENT_SETTINGS,
  repoId: null,
  provider: 'claude-code',
  cwd: '/project',
  additionalDirs: [],
  covers: [],
  providerSessionId: null,
  createdAt: 1,
  title: 'A finished thread',
}
const render = () => renderToStaticMarkup(createElement(AgentRow, { session, group: 'Done' }))
const click = () => {
  const stopPropagation = vi.fn()
  state.buttons[0]!.onClick!({ stopPropagation } as unknown as React.MouseEvent<HTMLButtonElement>)
  expect(stopPropagation).toHaveBeenCalledOnce()
}
beforeEach(() => {
  vi.clearAllMocks()
  state.buttons = []
  state.cards = []
  state.hostStatus = 'connected'
  state.task.workspaceId = null
  state.task.goalState = null
  state.task.doneAt = null
  state.invoke.mockResolvedValue(undefined)
})

it('marks a completed inbox thread done without archiving or closing it', async () => {
  const html = render()
  expect(html).toContain('aria-label="Mark thread done"')
  expect(html).toContain('title="Mark done"')
  expect(html).not.toContain('Archive')
  click()
  await vi.waitFor(() => expect(state.refresh).toHaveBeenCalledOnce())
  expect(state.invoke).toHaveBeenCalledExactlyOnceWith('tasks.done', 'thread', true)
  expect(state.forgetTask).not.toHaveBeenCalled()
})

it('reopens a thread that is already marked done', async () => {
  state.task.doneAt = 123
  expect(render()).toContain('aria-label="Reopen thread"')
  click()
  await vi.waitFor(() => expect(state.refresh).toHaveBeenCalledOnce())
  expect(state.invoke).toHaveBeenCalledExactlyOnceWith('tasks.done', 'thread', false)
})

it('reports a failed mark-done action without removing the thread', async () => {
  state.invoke.mockRejectedValueOnce(new Error('Cannot mark done'))
  render()
  click()
  await vi.waitFor(() => expect(state.notifyError).toHaveBeenCalledWith('Cannot mark done'))
  expect(state.refresh).not.toHaveBeenCalled()
  expect(state.forgetTask).not.toHaveBeenCalled()
})

it('gives Home rows their exact workspace and shared goal status without navigating or fetching', () => {
  state.task.workspaceId = 'checkout'
  state.task.goalState = { status: 'active', objective: 'Ship the change' }
  render()
  expect(state.cards).toEqual([
    expect.objectContaining({
      task: state.task,
      workspaceName: 'Feature checkout',
      offline: false,
      status: { kind: 'goal', short: 'Goal', full: 'Working toward goal' },
    }),
  ])
  expect(state.invoke).not.toHaveBeenCalled()
})

it('qualifies cached Home details when the host disconnects', () => {
  state.hostStatus = 'offline'
  render()
  expect(state.cards[0]?.offline).toBe(true)
})

it('does not show the parent checkout as a helper’s checkout', () => {
  renderToStaticMarkup(
    createElement(AgentRow, {
      session: { ...session, parentId: 'parent' },
      group: 'Done',
    }),
  )
  expect(state.cards).toEqual([])
})
