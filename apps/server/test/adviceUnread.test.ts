import { afterEach, beforeEach, expect, it } from 'vitest'
import { openDb } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { SessionStore } from '../src/agent/sessionStore'
import { markAdviceRead, readUnreadAdvice } from '../src/agent/adviceUnread'
import { DEFAULT_AGENT_SETTINGS, NO_PROJECT, type AgentEvent } from '@ramu/shared/types'

let db: ReturnType<typeof openDb>
beforeEach(() => {
  db = openDb(':memory:')
})
afterEach(() => db.close())

async function thread() {
  const workspace = new Workspace(db, '/tmp/ramu-advice-unread-test')
  const task = await workspace.createTask({ projectId: NO_PROJECT, title: 'Advice', mode: 'current' })
  const store = new SessionStore({ onEvent: () => {} }, db)
  const session = store.createSession(
    task.id,
    { cwd: '/tmp', additionalDirs: [], covers: ['/tmp'] },
    DEFAULT_AGENT_SETTINGS,
    'idle',
  )
  let seq = 0
  // The change counter the recorder keeps: every write takes the next number.
  const write = (event: AgentEvent) => {
    seq += 1
    db.prepare('INSERT INTO agent_events (session_id, seq, event, rev) VALUES (?, ?, ?, ?)').run(
      session.id,
      seq,
      JSON.stringify(event),
      seq,
    )
  }
  return { task, session, write }
}

it('counts settled advisor consultations until the advice is marked read', async () => {
  const { task, session, write } = await thread()
  write({ kind: 'agent', agentId: 'advisor-1', name: 'Advisor', status: 'running', taskType: 'advisor' })
  expect(readUnreadAdvice(db).has(task.id)).toBe(false)
  write({ kind: 'agent', agentId: 'advisor-2', name: 'Advisor', status: 'completed', taskType: 'advisor' })
  write({ kind: 'agent', agentId: 'advisor-3', name: 'Advisor', status: 'failed', taskType: 'advisor' })
  write({ kind: 'agent', agentId: 'worker', name: 'Worker', status: 'completed' })
  expect(readUnreadAdvice(db).get(task.id)).toBe(2)
  expect(readUnreadAdvice(db, task.id).get(task.id)).toBe(2)
  expect(readUnreadAdvice(db, 'other').size).toBe(0)

  markAdviceRead(db, session.id)
  expect(readUnreadAdvice(db).has(task.id)).toBe(false)
  // Marking again changes nothing, and a consultation that settles afterwards is unread again.
  markAdviceRead(db, session.id)
  write({ kind: 'agent', agentId: 'advisor-4', name: 'Advisor', status: 'completed', taskType: 'advisor' })
  expect(readUnreadAdvice(db).get(task.id)).toBe(1)
})

it('a consultation that was running when the advice was read is unread once it settles', async () => {
  const { task, session, write } = await thread()
  write({ kind: 'agent', agentId: 'advisor-1', name: 'Advisor', status: 'running', taskType: 'advisor' })
  markAdviceRead(db, session.id)
  // The recorder updates the row in place and bumps its counter when the consultation settles.
  db.prepare('UPDATE agent_events SET event = ?, rev = 99 WHERE session_id = ? AND seq = 1').run(
    JSON.stringify({ kind: 'agent', agentId: 'advisor-1', name: 'Advisor', status: 'completed', taskType: 'advisor' }),
    session.id,
  )
  expect(readUnreadAdvice(db).get(task.id)).toBe(1)
})
