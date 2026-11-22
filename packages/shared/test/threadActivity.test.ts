import { expect, it } from 'vitest'
import type { AgentEvent, AgentTask } from '../src/types'
import { latestTasks, effectiveStatus } from '../src/chat/agentTasks'
import {
  helperActions,
  helperCounts,
  helperElapsed,
  helperGroups,
  helperIdentity,
  helperStatusLabel,
} from '../src/chat/helperPresentation'
import { goalActivityLabel, threadActivity } from '../src/chat/threadActivity'
const task = (agentId: string, status: AgentTask['status'] = 'running', extra: Partial<AgentTask> = {}): AgentTask => ({
  agentId,
  name: agentId,
  status,
  ...extra,
})
const event = (t: AgentTask): AgentEvent => ({ ...t, kind: 'agent' })
it('preserves verification and turn-limit context without inventing an input request', () => {
  const base = {
    connected: true,
    working: false,
    helpers: [],
    advisors: [],
    requests: [],
    providerWait: false,
    queue: 0,
  }
  for (const goal of ['verifying', 'turn-limit'] as const) {
    expect(threadActivity({ ...base, goal })).toMatchObject({ primary: 'goal', goalState: goal, requestIds: [] })
  }
  expect(goalActivityLabel('verifying')).toBe('Verifying goal')
  expect(goalActivityLabel('turn-limit')).toBe('Goal turn limit reached')
})
it('keeps parent-idle helpers active, preserves stopped, and only permits reported capabilities on a connected host', () => {
  expect(effectiveStatus(task('a', 'running', { background: true }), false)).toBe('running')
  expect(helperCounts([task('a'), task('b', 'stopped'), task('c', 'failed'), task('d', 'completed')])).toMatchObject({
    active: 1,
    stopped: 1,
    failed: 1,
    completed: 1,
  })
  expect(helperActions(task('a'), true)).toEqual({ canMessage: false, canStop: false })
  expect(helperActions(task('a', 'running', { canMessage: true, canStop: true }), false)).toEqual({
    canMessage: false,
    canStop: false,
  })
  expect(helperActions(task('a', 'running', { canMessage: true, canStop: true }), true)).toEqual({
    canMessage: true,
    canStop: true,
  })
  expect(helperIdentity('a', 's', 'h')).not.toBe(helperIdentity('b', 's', 'h'))
})
it('ignores late progress after terminal state and accepts an explicit later resume', () => {
  const ended = task('a', 'completed', { endedAt: 20, summary: 'done' })
  expect(latestTasks([event(ended), event(task('a'))])[0]).toMatchObject({ status: 'completed', summary: 'done' })
  expect(latestTasks([event(ended), event(task('a', 'running', { resumedAt: 21 }))])[0]?.status).toBe('running')
  expect(latestTasks([event(ended), event(task('a', 'running', { resumedAt: 19 }))])[0]?.status).toBe('completed')
})
it('selects the current turn and earlier active helpers, separates advisor/history and keeps launch membership', () => {
  const events: AgentEvent[] = [
    { kind: 'user', text: 'first' },
    event(task('older-active')),
    event(task('old', 'completed')),
    { kind: 'user', text: 'second' },
    event(task('new', 'completed')),
    event(task('advice', 'running', { taskType: 'advisor' })),
  ]
  const model = helperGroups(events)
  expect(model.selected.map((t) => t.agentId)).toEqual(['older-active', 'new'])
  expect(model.advisors.map((t) => t.agentId)).toEqual(['advice'])
  expect(model.history.map((t) => t.agentId)).toEqual(['old'])
  expect(model.groups.find((g) => g.tasks.some((t) => t.agentId === 'old'))?.anchor).toBe(0)
  expect(helperGroups([...events, { kind: 'user', text: 'third' }]).selected.map((t) => t.agentId)).toEqual([
    'older-active',
  ])
})
it('marks recovered unknown launches as earlier activity and does not count their old process as active', () => {
  const events: AgentEvent[] = [
    { kind: 'user', text: 'request' },
    event(task('recovered', 'running', { recovered: true })),
  ]
  expect(helperGroups(events).groups[0]?.anchor).toBeNull()
  expect(helperGroups(events).selected).toEqual([])
  expect(helperStatusLabel(task('r', 'running', { recovered: true }))).toBe('Recovered activity')
  expect(helperElapsed(task('a', 'completed', { startedAt: 0, endedAt: 100 }), 900)).toBe(100)
  expect(helperElapsed(task('a', 'completed'), 900)).toBeNull()
})
it('prioritizes delivery, input and provider waits without dropping other actions, and settles completely', () => {
  const input = {
    connected: false,
    working: false,
    helpers: [task('a')],
    advisors: [],
    requests: [{ id: 'q', kind: 'permission' as const }],
    providerWait: true,
    queue: 2,
  }
  expect(threadActivity(input)).toMatchObject({
    primary: 'connection',
    secondary: ['input', 'provider', 'helpers', 'queue'],
    requestIds: ['q'],
    stale: true,
  })
  expect(threadActivity({ ...input, connected: true }).primary).toBe('input')
  expect(threadActivity({ ...input, connected: true, requests: [] }).primary).toBe('provider')
  expect(threadActivity({ ...input, connected: true, requests: [], providerWait: false }).primary).toBe('helpers')
  expect(
    threadActivity({ ...input, connected: true, requests: [], providerWait: false, helpers: [], queue: 0 }).primary,
  ).toBeNull()
})
