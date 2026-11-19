import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Task } from '@ramu/shared/types'
import { ArchivedThreads } from '../src/sidebar/ArchivedThreads'

const state = vi.hoisted(() => ({ tasks: [] as Task[], viewer: false }))
vi.mock('../src/composer/useHostWriteAccess', () => ({
  useHostWriteAccess: () => ({ viewOnly: state.viewer, canWrite: () => !state.viewer }),
}))
vi.mock('../src/i18n', () => ({ useLanguage: () => {}, t: (text: string) => text }))
vi.mock('../src/workspace/workspace', () => ({
  useWorkspace: () => ({ tasks: state.tasks, projects: [{ id: 'project', name: 'My project' }] }),
}))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ invoke: vi.fn() }) }))
vi.mock('../src/ipc', () => ({ invoke: vi.fn() }))
vi.mock('../src/Menu', () => ({ Dialog: () => null }))
vi.mock('../src/workspace/TaskPane', () => ({ errorText: String }))
vi.mock('@/components/desktop-button', () => ({
  Button: ({ variant: _variant, ...props }: ComponentProps<'button'> & { variant?: string }) =>
    createElement('button', props),
}))
vi.mock('../src/sidebar/projects/TaskRow', () => ({
  TaskRow: ({ task, projectName }: { task: Task; projectName?: string }) =>
    createElement('div', {}, `${projectName}: ${task.title}`),
}))
const task = (id: string, status: Task['status'], doneAt?: number): Task => ({
  id,
  title: id,
  status,
  doneAt,
  projectId: 'project',
  mode: 'current',
  workspaceId: null,
  createdAt: 1,
  lastActiveAt: 1,
  pinnedAt: null,
})
beforeEach(() => {
  state.viewer = false
  state.tasks = []
})

it('shows archived history with project context while excluding active and done threads', () => {
  state.tasks = [task('Archived example', 'archived'), task('Active example', 'idle'), task('Done example', 'idle', 10)]
  const html = renderToStaticMarkup(createElement(ArchivedThreads))
  expect(html).toContain('My project: Archived example')
  expect(html).not.toContain('Active example')
  expect(html).not.toContain('Done example')
  expect(html).toContain('Delete all archived threads')
})

it('shows an empty state without a bulk delete action when there are no archived threads', () => {
  const html = renderToStaticMarkup(createElement(ArchivedThreads))
  expect(html).toContain('No archived threads')
  expect(html).not.toContain('Delete all archived threads')
})

it('keeps archived history readable for a viewer without offering bulk deletion', () => {
  state.tasks = [task('Archived example', 'archived')]
  state.viewer = true
  const html = renderToStaticMarkup(createElement(ArchivedThreads))
  expect(html).toContain('My project: Archived example')
  expect(html).not.toContain('Delete all archived threads')
  expect(html).toContain('view-only')
})
