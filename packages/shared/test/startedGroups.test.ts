import { expect, it } from 'vitest'
import type { Task } from '../src/types'
import { memberState, startedGroups } from '../src/workspace/startedGroups'
import { namedProjects } from '../src/workspace/projectRouting'

const now = Date.UTC(2026, 10, 1)
const task = (id: string, groupId: string | null, extra: Partial<Task> = {}): Task =>
  ({
    id,
    projectId: 'p',
    title: id,
    mode: 'current',
    workspaceId: null,
    status: 'idle',
    createdAt: now - 1000,
    pinnedAt: null,
    lastActiveAt: now,
    ...(groupId ? { startedFrom: { groupId, taskId: null, title: null, groupSize: 2 } } : {}),
    ...extra,
  }) as Task

it('groups threads one Home prompt started across hosts, and leaves agent-started and lone threads out', () => {
  const groups = startedGroups(
    [
      { hostId: 'laptop', tasks: [task('api', 'g1', { executionState: 'running' }), task('solo', null)] },
      {
        hostId: 'vps',
        tasks: [
          task('jobs', 'g1', { executionState: 'needs-input' }),
          task('child', 'g2', { startedFrom: { groupId: 'g2', taskId: 'parent', title: 'Parent', groupSize: 1 } }),
          task('alone', 'g3'),
        ],
      },
    ],
    now,
  )
  expect(groups).toHaveLength(1)
  expect(groups[0]!.members.map((member) => [member.hostId, member.task.id, member.state])).toEqual([
    ['laptop', 'api', 'running'],
    ['vps', 'jobs', 'waiting'],
  ])
  expect(groups[0]!.counts).toMatchObject({ running: 1, waiting: 1 })
})

it('keeps a settled group for a few days and drops archived threads', () => {
  const old = now - 4 * 86_400_000
  const settled = [task('a', 'g', { createdAt: old }), task('b', 'g', { createdAt: old, executionState: 'failed' })]
  expect(startedGroups([{ hostId: 'h', tasks: settled }], now)).toEqual([])
  expect(startedGroups([{ hostId: 'h', tasks: settled }], old + 1000)).toHaveLength(1)
  const archived = [task('a', 'g'), task('b', 'g', { status: 'archived' })]
  expect(startedGroups([{ hostId: 'h', tasks: archived }], now)).toEqual([])
  expect(memberState(task('x', null, { inputSummary: { count: 1 } as Task['inputSummary'] }))).toBe('waiting')
})

it('counts projects named separately, not a name inside a longer one', () => {
  const projects = [
    { id: 'r', name: 'Ramu' },
    { id: 'm', name: 'Ramu Mobile' },
    { id: 'b', name: 'Billing' },
  ]
  expect(namedProjects('Fix Ramu Mobile login', projects)).toEqual(['m'])
  expect(namedProjects('Billing and Ramu Mobile: add due dates', projects)).toEqual(['m', 'b'])
})
