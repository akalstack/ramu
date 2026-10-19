import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Task } from '@ramu/shared/types'

type Action = { key?: string; label?: ReactNode; disabled?: boolean; onSelect?: () => void }
const state = vi.hoisted(() => ({ actions: [] as Action[], calls: [] as unknown[][], activeHost: 'remote' }))
vi.mock('../src/workspace/computers', () => ({ useComputers: () => null }))
vi.mock('../src/workspace/HostProvider', () => ({
  useHost: () => ({
    id: 'remote',
    status: 'connected',
    invoke: async (...args: unknown[]) => {
      state.calls.push(args)
    },
  }),
}))
vi.mock('../src/workspace/HostSelection', () => ({
  useHostSelection: () => ({ activeHost: state.activeHost, select() {} }),
}))
vi.mock('../src/workspace/workspace', () => ({
  useRowStore: () => ({
    tasks: [],
    workspaces: [],
    ui: { openTaskIds: [], activeTaskId: null },
    unread: new Set(),
    refresh: async () => {},
  }),
}))
vi.mock('../src/models/ModelSets', () => ({
  useModelSets: () => ({ initialSettings: { provider: 'codex', model: 'chosen' } }),
}))
vi.mock('../src/i18n', () => ({ useLanguage() {}, t: (text: string) => text }))
vi.mock('../src/Menu', () => ({
  Dialog: () => null,
  useContextMenu: (_name: string, actions: Action[]) => {
    state.actions = actions
    return { onContextMenu() {}, onKeyDown() {}, menu: null }
  },
}))
vi.mock('../src/components/desktop-button', () => ({ Button: () => null }))
vi.mock('../src/components/ui/checkbox', () => ({ Checkbox: () => null }))
vi.mock('../src/sidebar/projects/InlineEdit', () => ({ InlineEdit: () => null }))
vi.mock('../src/sidebar/projects/TaskStateIcon', () => ({ TaskStateIcon: () => null }))
vi.mock('../src/FadeText', () => ({ FadeText: ({ text }: { text: string }) => text }))
vi.mock('../src/workspace/TaskPane', () => ({ errorText: String }))
vi.mock('../src/chat/Notifications', () => ({ notifyError() {} }))
vi.mock('../src/ipc', () => ({ copyText: async () => {} }))
import { TaskRow } from '../src/sidebar/projects/TaskRow'

const task: Task = {
  id: 'task',
  projectId: 'project',
  title: 'User title',
  mode: 'current',
  workspaceId: null,
  status: 'idle',
  createdAt: 1,
  pinnedAt: null,
  lastActiveAt: 1,
}
beforeEach(() => {
  state.actions = []
  state.calls = []
  state.activeHost = 'remote'
})
const action = () => state.actions.find((item) => item.key === 'rename-ai')!

it('shows synchronized pending title work with an accessible label and an available manual rename', () => {
  const markup = renderToStaticMarkup(createElement(TaskRow, { task: { ...task, titleGenerationState: 'pending' } }))
  expect(markup).toContain('aria-label="Naming thread"')
  expect(action().disabled).toBe(true)
  expect(renderToStaticMarkup(createElement('span', null, action().label))).toContain('Naming thread')
  expect(state.actions.find((item) => item.key === 'rename')?.disabled).not.toBe(true)
})

it('offers retry after failure and dispatches one explicit generation on the correct host', async () => {
  renderToStaticMarkup(createElement(TaskRow, { task: { ...task, titleGenerationState: 'failed' } }))
  expect(renderToStaticMarkup(createElement('span', null, action().label))).toContain('Retry title generation')
  expect(action().disabled).toBe(false)
  action().onSelect!()
  action().onSelect!()
  await Promise.resolve()
  expect(state.calls).toEqual([['tasks.generateTitle', 'task', { provider: 'codex', model: 'chosen' }, true]])
})

it('does not route title generation from another host through this window’s model selection', () => {
  state.activeHost = 'another'
  renderToStaticMarkup(createElement(TaskRow, { task }))
  expect(action().disabled).toBe(true)
  action().onSelect!()
  expect(state.calls).toEqual([])
})
