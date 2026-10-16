import { afterEach, expect, it } from 'vitest'
import { openDb } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { SessionStore } from '../src/agent/sessionStore'
import { AgentService } from '../src/agent'
import { fakeQuery } from '../src/providers/fakeAgent'
import { DEFAULT_AGENT_SETTINGS, NO_PROJECT, type AgentEvent } from '@ramu/shared/types'
const db = openDb(':memory:')
afterEach(() => db.close())
it('includes helpers, pending asynchronous input and durable usage waits without duplicating managed helpers', async () => {
  const workspace = new Workspace(db, '/tmp/ramu-overview-test')
  const task = await workspace.createTask({ projectId: NO_PROJECT, title: 'Overview', mode: 'current' })
  const store = new SessionStore({ onEvent: () => {} }, db)
  const scope = { cwd: '/tmp', additionalDirs: [], covers: ['/tmp'] }
  const parent = store.createSession(task.id, scope, DEFAULT_AGENT_SETTINGS, 'running')
  const child = store.createSession(task.id, scope, DEFAULT_AGENT_SETTINGS, 'running', parent.id)
  let seq = 0
  const record = (event: AgentEvent) =>
    db
      .prepare('INSERT INTO agent_events (session_id, seq, event) VALUES (?, ?, ?)')
      .run(parent.id, ++seq, JSON.stringify(event))
  record({
    kind: 'question',
    requestId: 'pending',
    responseMode: 'message',
    questions: [{ id: 'x', question: 'A decision?', header: 'Choice', multiSelect: false, options: [] }],
  })
  record({ kind: 'agent', agentId: child.id, name: 'Managed helper', status: 'running' })
  record({
    kind: 'agent',
    agentId: 'native-helper',
    name: 'Native helper',
    status: 'running',
    background: true,
    canStop: true,
  })
  const service = new AgentService(db, () => {}, fakeQuery)
  const rows = service.all()
  expect(rows.find((s) => s.id === parent.id)?.pendingInput).toBe(true)
  expect(rows.filter((s) => s.parentId === parent.id)).toHaveLength(2)
  expect(rows.find((s) => s.nativeTask)?.nativeTask?.agentId).toBe('native-helper')
  record({ kind: 'request-resolved', requestId: 'pending', outcome: 'answered' })
  expect(service.all().find((s) => s.id === parent.id)?.pendingInput).toBe(false)
  service.stopAll()
})
