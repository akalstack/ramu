import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { AgentEvent, ChatGoal, Task } from '@ramu/shared/types'
import { inputSummary } from '@ramu/shared/chat/inputSummary'
import { openDb, type Db } from '../src/db'
import { SessionStore } from '../src/agent/sessionStore'
import { createDispatcher, type Services } from '../src/ipc'
let db: Db, store: SessionStore, directory: string, file: string
const events = new Map<string, AgentEvent[]>()
const add = (session: string, event: AgentEvent) => {
  const rows = events.get(session) ?? []
  rows.push(event)
  events.set(session, rows)
  db.prepare('INSERT INTO agent_events (session_id,seq,event) VALUES (?,?,?)').run(
    session,
    rows.length,
    JSON.stringify(event),
  )
}
const approval = (requestId: string): Extract<AgentEvent, { kind: 'permission-request' }> => ({
  kind: 'permission-request',
  requestId,
  title: 'Approve command',
  toolName: 'Bash',
  detail: 'must not be exposed',
})
beforeEach(() => {
  events.clear()
  directory = mkdtempSync(join(tmpdir(), 'ramu-input-summary-'))
  file = join(directory, 'state.sqlite')
  db = openDb(file)
  db.exec(
    "INSERT INTO projects(id,name,created_at) VALUES('p','Project',0); INSERT INTO tasks(id,project_id,title,mode,status,created_at) VALUES('t','p','Thread','current','running',0),('other','p','Other','current','idle',0)",
  )
  for (const [id, task, parent] of [
    ['main', 't', null],
    ['second', 't', null],
    ['child', 't', 'main'],
    ['elsewhere', 'other', null],
  ] as const)
    db.prepare(
      "INSERT INTO agent_sessions(id,task_id,provider,cwd,state,created_at,parent_session_id) VALUES(?,?,'codex','/tmp','running',0,?)",
    ).run(id, task, parent)
  store = new SessionStore({ onEvent() {} }, db)
})
afterEach(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})
it('returns bounded identity/origin summaries through agent lists and task RPC without loading transcripts', async () => {
  add('main', {
    ...approval('forwarded'),
    requestSource: { sessionId: 'child', agentId: 'child', name: 'Builder', requestId: 'local' },
  })
  for (let i = 0; i < 6; i++) add('main', { ...approval('a' + i), title: 'x'.repeat(500) })
  add('child', approval('local'))
  add('elsewhere', approval('other'))
  expect(store.list('t')[0]!.inputSummary).toMatchObject({
    count: 7,
    approvals: 7,
    requests: expect.arrayContaining([
      expect.objectContaining({ requestId: 'forwarded', source: expect.objectContaining({ requestId: 'local' }) }),
    ]),
  })
  expect(store.list('t')[0]!.inputSummary?.requests).toHaveLength(3)
  expect(store.all().find((s) => s.id === 'main')?.pendingInput).toBe(true)
  expect(store.all().find((s) => s.id === 'main')?.inputSummary?.requests[1]!.title).toHaveLength(240)
  const dispatcher = createDispatcher({ userData: '/tmp/ramu-input-summary', native: async () => null, send() {} }, {
    workspace: {
      getAppState: (_key: string, fallback: unknown) => fallback,
      listTasks: () => [{ id: 't', title: 'Thread' }],
    },
    agents: {
      helperSummaries: () => new Map(),
      unreadAdvice: () => new Map(),
      list: (task: string) => store.list(task),
      listByTask: () => store.listByTask(),
      providerUses: () => new Map(),
      goalOf: () => null,
    },
  } as unknown as Services)
  try {
    const [task] = (await dispatcher.invoke('tasks.list', [])) as {
      inputSummary: { count: number; requests: unknown[] }
    }[]
    if (!task) throw new Error('Task summary missing')
    expect(task.inputSummary.count).toBe(7) // Forwarded child input is counted once, other threads stay isolated.
    expect(task.inputSummary.requests).toHaveLength(3)
    expect(JSON.stringify(task)).not.toContain('must not be exposed')
  } finally {
    dispatcher.close()
  }
})
it('exposes bounded verification context without leaking command output into task lists', async () => {
  let goal: ChatGoal = {
    id: 'goal',
    status: 'active',
    objective: 'x'.repeat(500),
    updatedAt: 1,
    turns: 0,
    reason: '',
    claim: { reason: 'private evidence', evidence: { checks: [], changedFiles: [] }, at: 1 },
    check: {
      command: 'private command',
      ok: false,
      code: 1,
      timedOut: false,
      output: 'private output',
      at: 1,
      delivered: true,
    },
  }
  const dispatcher = createDispatcher({ userData: '/tmp/ramu-goal-summary', native: async () => null, send() {} }, {
    workspace: { getAppState: (_key: string, fallback: unknown) => fallback, listTasks: () => [{ id: 't' }] },
    agents: {
      helperSummaries: () => new Map(),
      unreadAdvice: () => new Map(),
      list: (task: string) => store.list(task),
      listByTask: () => store.listByTask(),
      providerUses: () => new Map(),
      goalOf: () => goal,
    },
  } as unknown as Services)
  try {
    const [task] = (await dispatcher.invoke('tasks.list', [])) as Task[]
    expect(task?.goalState).toMatchObject({ status: 'active', verifying: true, verificationFailed: true })
    expect(task?.goalState?.objective).toHaveLength(300)
    expect(task?.goalState?.sessionId).toBe(store.list('t').at(-1)?.id)
    expect(JSON.stringify(task)).not.toContain('private')
    goal = { ...goal, status: 'completed' }
    expect(((await dispatcher.invoke('tasks.list', [])) as Task[])[0]?.goalState).toBeNull()
  } finally {
    dispatcher.close()
  }
})

it('matches the event fold for reused IDs, resolutions and unrelated helper events', () => {
  add('main', approval('reused'))
  add('main', { kind: 'request-resolved', requestId: 'reused', outcome: 'allowed' })
  expect(store.list('t')[0]!.inputSummary).toBeNull()
  add('main', approval('reused'))
  add('main', { ...approval('hidden'), agentId: 'helper' })
  add('main', {
    kind: 'question',
    requestId: 'q',
    questions: [{ question: 'Next branch?', header: '', multiSelect: false, options: [] }],
  })
  add('main', {
    kind: 'elicitation',
    requestId: 'e',
    serverName: 'service',
    message: 'Choose an account',
    mode: 'form',
    fields: [],
  })
  expect(store.list('t')[0]!.inputSummary).toEqual(inputSummary(events.get('main')!, 'main'))
})
it('replaces discarded input on rewind and clears stale prompts from stopped or failed sessions', () => {
  add('main', approval('old'))
  expect(store.list('t')[0]!.inputSummary?.count).toBe(1)
  db.prepare('DELETE FROM agent_events WHERE session_id=?').run('main')
  expect(store.list('t')[0]!.inputSummary).toBeNull()
  add('main', approval('new'))
  for (const state of ['stopped', 'failed']) {
    db.prepare('UPDATE agent_sessions SET state=? WHERE id=?').run(state, 'main')
    expect(store.list('t')[0]!.inputSummary).toBeNull()
    expect(store.all().find((s) => s.id === 'main')?.pendingInput).toBe(false)
  }
})

it('reconstructs unresolved identity and origin after a database reopen, without a parallel cache', () => {
  add('main', {
    ...approval('forwarded'),
    requestSource: { sessionId: 'child', agentId: 'child', name: 'Builder', requestId: 'local' },
  })
  const before = store.list('t')[0]!.inputSummary
  db.close()
  db = openDb(file)
  store = new SessionStore({ onEvent() {} }, db)
  expect(store.list('t')[0]!.inputSummary).toEqual(before)
  add('main', { kind: 'request-resolved', requestId: 'forwarded', outcome: 'denied' })
  expect(store.list('t')[0]!.inputSummary).toBeNull()
})
