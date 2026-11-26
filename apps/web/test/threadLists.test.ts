import { expect, it } from 'vitest'
import { NO_PROJECT, type Task } from '@ramu/shared/types'
import { archivedThreads, sidebarThreads } from '../src/sidebar/projects/threadLists'

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  projectId: 'project',
  status: 'idle',
  mode: 'current',
  workspaceId: null,
  createdAt: 1,
  lastActiveAt: 1,
  pinnedAt: null,
  ...extra,
})

it('gathers done threads from all projects, pinned threads and projectless threads in completion order', () => {
  const tasks = [
    task('active'),
    task('pinned', { pinnedAt: 10 }),
    task('done-project', { doneAt: 10 }),
    task('done-loose', { projectId: NO_PROJECT, doneAt: 30 }),
    task('done-pinned', { projectId: 'other', pinnedAt: 5, doneAt: 20 }),
    task('archived', { status: 'archived' }),
    task('archived-done', { status: 'archived', doneAt: 40 }),
  ]
  const result = sidebarThreads(tasks)
  expect(result.active.map((entry) => entry.id)).toEqual(['active', 'pinned'])
  expect(result.done.map((entry) => entry.id)).toEqual(['done-loose', 'done-pinned', 'done-project'])
  expect(tasks.map((entry) => entry.id)).toEqual([
    'active',
    'pinned',
    'done-project',
    'done-loose',
    'done-pinned',
    'archived',
    'archived-done',
  ])
})

it('returns reopened threads to active lists and supports old threads without doneAt', () => {
  const result = sidebarThreads([task('reopened', { doneAt: null }), task('legacy')])
  expect(result.active.map((entry) => entry.id)).toEqual(['reopened', 'legacy'])
  expect(result.done).toEqual([])
})

it('bounds local and remote project previews, keeps an older active thread, and expands without including done or pinned threads', async () => {
  const { projectThreadPreview } = await import('../src/sidebar/projects/threadLists')
  const tasks = [
    ...Array.from({ length: 15 }, (_, i) => task(`thread-${i}`, { lastActiveAt: 100 - i })),
    task('pinned', { pinnedAt: 5 }),
    task('done', { doneAt: 5 }),
    task('archived', { status: 'archived' }),
    task('elsewhere', { projectId: 'other' }),
  ]
  const preview = projectThreadPreview(tasks, 'project', 3, false, 'thread-12')
  expect(preview.tasks.map((entry) => entry.id)).toEqual(['thread-0', 'thread-1', 'thread-2', 'thread-12'])
  expect(preview.hasMore).toBe(true)
  expect(projectThreadPreview(tasks, 'project', 3, true).tasks).toHaveLength(15)
  expect(projectThreadPreview(tasks, 'empty', 3, false)).toMatchObject({ tasks: [], hasMore: false })
})

it('bounds projectless threads like a project and keeps every host source when merging', async () => {
  const { mergedThreads, projectThreadPreview } = await import('../src/sidebar/projects/threadLists')
  const loose = Array.from({ length: 8 }, (_, i) => task(`loose-${i}`, { projectId: NO_PROJECT, lastActiveAt: 10 - i }))
  const preview = projectThreadPreview(loose, NO_PROJECT, 5, false)
  expect(preview.tasks).toHaveLength(5)
  expect(preview.hasMore).toBe(true)

  const merged = mergedThreads(
    [
      { host: 'a', done: [task('one')] },
      { host: 'b', done: [task('two')] },
    ],
    (source) => source.done,
  )
  expect(merged.map(({ task, source }) => `${source.host}:${task.id}`)).toEqual(['a:one', 'b:two'])
})

it('keeps a host tree key independent of which host is on screen', async () => {
  const { sidebarTreeKey } = await import('../src/sidebar/projects/threadLists')
  expect(sidebarTreeKey('own', 'own', 'project:p')).toBe('project:p')
  expect(sidebarTreeKey('mini', 'own', 'project:p')).toBe('host:mini:project:p')
})

it('reads a shared section as closed from its own key or any host namespace, and from nothing else', async () => {
  const { sharedSectionKeys } = await import('../src/sidebar/projects/threadLists')
  expect(sharedSectionKeys(['section:pinned', 'host:mini:section:chats'], 'section:done')).toEqual([])
  expect(sharedSectionKeys(['section:done', 'project:p'], 'section:done')).toEqual(['section:done'])
  expect(sharedSectionKeys(['host:mini:section:done', 'host:mini:host'], 'section:done')).toEqual([
    'host:mini:section:done',
  ])
})

it('folds quiet schedule runs into the newest and keeps runs that still have something to show', async () => {
  const { projectThreadPreview } = await import('../src/sidebar/projects/threadLists')
  const run = (id: string, lastActiveAt: number, extra: Partial<Task> = {}) =>
    task(id, { scheduleId: 'daily', lastActiveAt, ...extra })
  const tasks = [
    run('newest', 50),
    run('quiet', 40),
    run('waiting', 30, { status: 'needs-input' }),
    run('unread', 20),
    run('open', 10),
    task('person', { lastActiveAt: 5 }),
  ]
  const preview = projectThreadPreview(tasks, 'project', 10, false, 'open', new Set(['unread']))
  expect(preview.tasks.map((entry) => entry.id)).toEqual(['newest', 'waiting', 'unread', 'open', 'person'])
  expect(preview.earlierRuns).toEqual({ newest: 1 })
  expect(preview.hasMore).toBe(true)

  const expanded = projectThreadPreview(tasks, 'project', 10, true, 'open')
  expect(expanded.tasks).toHaveLength(6)
  expect(expanded.earlierRuns).toEqual({})
})

it('counts only threads blocked on the person as needing them', async () => {
  const { threadNeedsYou } = await import('../src/sidebar/projects/threadLists')
  expect(threadNeedsYou(task('input', { status: 'needs-input' }))).toBe(true)
  expect(threadNeedsYou(task('failed', { status: 'failed' }))).toBe(false)
  expect(threadNeedsYou(task('running', { status: 'running' }))).toBe(false)
  expect(threadNeedsYou(task('idle'))).toBe(false)
})

it('lists only archived threads for the Archived view, most recently active first', () => {
  const tasks = [
    task('old', { status: 'archived', lastActiveAt: 1 }),
    task('active', { lastActiveAt: 5 }),
    task('new', { status: 'archived', lastActiveAt: 9, doneAt: 3 }),
  ]
  expect(archivedThreads(tasks).map((entry) => entry.id)).toEqual(['new', 'old'])
})
