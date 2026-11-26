import { afterEach, beforeEach, expect, it } from 'vitest'
import { openDb } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { SessionStore } from '../src/agent/sessionStore'
import { readHelperSummaries } from '../src/agent/helperSummaries'
import { DEFAULT_AGENT_SETTINGS, NO_PROJECT, type AgentEvent } from '@ramu/shared/types'

let db: ReturnType<typeof openDb>
beforeEach(() => {
  db = openDb(':memory:')
})
afterEach(() => db.close())

it('counts independently running helpers, not advisors, shell commands, restored or finished activity', async () => {
  const workspace = new Workspace(db, '/tmp/ramu-helper-summary-test')
  const task = await workspace.createTask({ projectId: NO_PROJECT, title: 'Helpers', mode: 'current' })
  const store = new SessionStore({ onEvent: () => {} }, db)
  const scope = { cwd: '/tmp', additionalDirs: [], covers: ['/tmp'] }
  const parent = store.createSession(task.id, scope, DEFAULT_AGENT_SETTINGS, 'idle')
  let seq = 0
  const record = (event: AgentEvent) =>
    db
      .prepare('INSERT INTO agent_events (session_id, seq, event) VALUES (?, ?, ?)')
      .run(parent.id, ++seq, JSON.stringify(event))
  record({ kind: 'agent', agentId: 'a', name: 'Worker', status: 'running' })
  record({ kind: 'agent', agentId: 'b', name: 'Waiting', status: 'running', waitingFor: 'input' })
  record({ kind: 'agent', agentId: 'c', name: 'Advisor', status: 'running', taskType: 'advisor' })
  record({ kind: 'agent', agentId: 'd', name: 'Dev server', status: 'running', taskType: 'local_bash' })
  record({ kind: 'agent', agentId: 'e', name: 'Restored', status: 'running', recovered: true })
  record({ kind: 'agent', agentId: 'f', name: 'Done', status: 'completed' })
  expect(readHelperSummaries(db).get(task.id)).toEqual({ active: 2, waiting: 1 })
  expect(store.helperSummary(parent.id)).toEqual({ active: 2, waiting: 1 })
  // A command the agent said it is waiting on holds the thread; one restored without a process does not.
  record({ kind: 'agent', agentId: 'g', name: 'Tests', status: 'running', taskType: 'local_bash', awaited: true })
  record({
    kind: 'agent',
    agentId: 'h',
    name: 'Old tests',
    status: 'running',
    taskType: 'local_bash',
    awaited: true,
    recovered: true,
  })
  expect(readHelperSummaries(db).get(task.id)).toEqual({ active: 3, waiting: 1 })
  expect(store.helperSummary(parent.id)).toEqual({ active: 3, waiting: 1 })
  expect(readHelperSummaries(db, 'other').size).toBe(0)
})

it('reports nothing for a thread with only an advisor running', async () => {
  const workspace = new Workspace(db, '/tmp/ramu-helper-summary-test-2')
  const task = await workspace.createTask({ projectId: NO_PROJECT, title: 'Advice', mode: 'current' })
  const store = new SessionStore({ onEvent: () => {} }, db)
  const parent = store.createSession(
    task.id,
    { cwd: '/tmp', additionalDirs: [], covers: ['/tmp'] },
    DEFAULT_AGENT_SETTINGS,
    'idle',
  )
  db.prepare('INSERT INTO agent_events (session_id, seq, event) VALUES (?, 1, ?)').run(
    parent.id,
    JSON.stringify({ kind: 'agent', agentId: 'x', name: 'Advisor', status: 'running', taskType: 'advisor' }),
  )
  expect(readHelperSummaries(db).has(task.id)).toBe(false)
})
