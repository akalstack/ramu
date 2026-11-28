import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentService } from '../src/agent'
import { openDb, type Db } from '../src/db'
import { fakeQuery } from '../src/providers/fakeAgent'
import { DEFAULT_AGENT_SETTINGS, type AgentEvent } from '@ramu/shared/types'

let db: Db
let tmp: string
let cwd: string

beforeEach(() => {
  db = openDb(':memory:')
  tmp = mkdtempSync(join(tmpdir(), 'ramu-changes-'))
  cwd = realpathSync(tmp)
  mkdirSync(cwd, { recursive: true })
  db.exec(`INSERT INTO projects (id, name, created_at) VALUES ('p', 'P', 0); INSERT INTO repositories VALUES ('r', 'p', 'repo', '${cwd}');
           INSERT INTO tasks (id, project_id, title, mode, status, created_at) VALUES ('t', 'p', 'T', 'current', 'idle', 0);`)
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const until = async (cond: () => boolean, ms = 5000) => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('agent.changes', () => {
  const start = async () => {
    const svc = new AgentService(db, () => {}, fakeQuery)
    const session = svc.start('t', { cwd, additionalDirs: [], covers: [cwd] }, 'hello', DEFAULT_AGENT_SETTINGS)
    await until(() => svc.get(session.id).state === 'idle')
    const record = (event: AgentEvent) =>
      (svc as unknown as { record(id: string, event: AgentEvent): void }).record(session.id, event)
    return { svc, id: session.id, record }
  }

  it('sends a long catch-up in parts to a client that asks, and a snapshot to one that does not', async () => {
    const { svc, id, record } = await start()
    const first = svc.changes(id, 0, 0)
    for (let index = 0; index < 5; index++)
      record({ kind: 'text', text: `note ${index}\n\n`, messageId: `n${index}` } as AgentEvent)
    const whole = svc.changes(id, first.cursor, first.lastSeq)
    expect(whole.events.length).toBeGreaterThan(2)

    // An older client is given everything at once.
    expect(svc.changes(id, first.cursor, first.lastSeq, 2).reset).toBe(true)

    const seen: number[] = []
    let cursor = first.cursor
    for (let parts = 0; parts < 10; parts++) {
      const part = svc.changes(id, cursor, first.lastSeq, 2, undefined, true)
      expect(part.reset).toBe(false)
      expect(part.events.length).toBeLessThanOrEqual(2)
      seen.push(...part.events.map((entry) => entry.seq))
      cursor = part.cursor
      if (!part.more) break
    }
    expect(seen).toEqual(whole.events.map((entry) => entry.seq))
    expect(cursor).toBe(whole.cursor)
  })

  it('sends a snapshot in bounded parts to a client that takes them, every row once and in order', async () => {
    const { svc, id, record } = await start()
    for (let index = 0; index < 7; index++)
      record({ kind: 'text', text: `note ${index}\n\n`, messageId: `n${index}` } as AgentEvent)
    const all = svc.changes(id, 0, 0).events.map((entry) => entry.seq)
    // An older client, which passes no snapshot argument, still gets the snapshot whole.
    expect(svc.changes(id, 0, 0, 3, undefined, true)).toMatchObject({
      reset: true,
      events: all.map(() => expect.anything()),
    })

    const first = svc.changes(id, 0, 0, 3, undefined, true, 0)
    expect(first).toMatchObject({ reset: true, more: true })
    const seen = first.events.map((entry) => entry.seq)
    let after = first.after
    for (let parts = 0; after !== undefined && parts < 10; parts++) {
      const part = svc.changes(id, first.cursor, 0, 3, undefined, true, after)
      expect(part.reset).toBe(false)
      expect(part.events.length).toBeLessThanOrEqual(3)
      seen.push(...part.events.map((entry) => entry.seq))
      after = part.after
    }
    expect(seen).toEqual(all)
    // A client holding a usable cursor still gets only what changed.
    expect(svc.changes(id, first.cursor, Math.max(...all), 3, undefined, true, 0)).toMatchObject({
      reset: false,
      events: [],
    })
    svc.stop(id)
  })

  it('sends a full snapshot first, then only what changed, including rows edited in place', async () => {
    const { svc, id, record } = await start()
    const first = svc.changes(id, 0, 0)
    expect(first.reset).toBe(true)
    expect(first.events.length).toBeGreaterThan(0)
    expect(first.events.map((row) => row.seq)).toEqual(svc.changes(id, 0, 0).events.map((row) => row.seq))

    // Nothing changed: an empty, non-reset answer.
    const quiet = svc.changes(id, first.cursor, first.lastSeq)
    expect(quiet).toMatchObject({ reset: false, events: [] })

    record({ kind: 'text', text: 'draft\n\n', messageId: 'm1' } as AgentEvent)
    const appended = svc.changes(id, first.cursor, first.lastSeq)
    expect(appended.reset).toBe(false)
    expect(appended.events).toHaveLength(1)

    // An earlier row edited in place shows up even though its sequence is not new.
    record({ kind: 'text', text: 'draft\n\nfinal\n\n', messageId: 'm1' } as AgentEvent)
    // Finished blocks go out at most every 400ms, so the second one follows on its own shortly after.
    await until(() => svc.changes(id, appended.cursor, appended.lastSeq).events.length > 0)
    const edited = svc.changes(id, appended.cursor, appended.lastSeq)
    expect(edited.reset).toBe(false)
    expect(edited.events).toEqual([
      { seq: appended.events[0]!.seq, event: expect.objectContaining({ text: 'draft\n\nfinal\n\n' }) },
    ])
    expect(edited.cursor).toBeGreaterThan(appended.cursor)
    expect(edited.lastSeq).toBe(appended.lastSeq)
  })

  it('sends a reply a whole block at a time, and the rest once the agent moves on', async () => {
    const { svc, id, record } = await start()
    const reply = () => svc.events(id).find((event) => event.kind === 'text' && event.messageId === 'r1')
    record({ kind: 'text', text: 'Half a sen', messageId: 'r1' } as AgentEvent)
    expect(reply()).toBeUndefined()
    record({ kind: 'text', text: 'Whole sentence.\n\nNext one is hal', messageId: 'r1' } as AgentEvent)
    expect(reply()).toMatchObject({ text: 'Whole sentence.\n\n' })
    record({ kind: 'tool-use', toolUseId: 'u1', name: 'Read', input: {} } as AgentEvent)
    expect(reply()).toMatchObject({ text: 'Whole sentence.\n\nNext one is hal' })
  })

  it('sends a reply that goes quiet mid-block whole, and never takes back what showed', async () => {
    const { svc, id, record } = await start()
    const reply = () => svc.events(id).find((event) => event.kind === 'text' && event.messageId === 'r2')
    record({ kind: 'text', text: 'Thinking out lou', messageId: 'r2' } as AgentEvent)
    expect(reply()).toBeUndefined()
    await until(() => reply() !== undefined)
    expect(reply()).toMatchObject({ text: 'Thinking out lou' })
    record({ kind: 'text', text: 'Thinking out loud.\n\nMore', messageId: 'r2' } as AgentEvent)
    await until(() => (reply() as { text: string }).text === 'Thinking out loud.\n\nMore')
  })

  it('resets for a cursor from the future or a client holding rows that no longer exist', async () => {
    const { svc, id } = await start()
    const head = svc.changes(id, 0, 0)
    expect(svc.changes(id, head.cursor + 5, head.lastSeq).reset).toBe(true)
    expect(svc.changes(id, head.cursor, head.lastSeq + 3).reset).toBe(true)
  })

  it('resets after a rewind removed rows the client still holds', async () => {
    const { svc, id } = await start()
    await svc.send(id, 'second')
    await until(() => svc.get(id).state === 'idle' && svc.events(id).filter((e) => e.kind === 'user').length === 2)
    const before = svc.changes(id, 0, 0)
    const secondUser = before.events.filter((row) => row.event.kind === 'user')[1]!
    await svc.rewind(id, secondUser.seq)
    const after = svc.changes(id, before.cursor, before.lastSeq)
    expect(after.reset).toBe(true)
    expect(after.events.length).toBeLessThan(before.events.length)
  })

  it('bounds a large change set by falling back to a snapshot', async () => {
    const { svc, id, record } = await start()
    const head = svc.changes(id, 0, 0)
    for (let i = 0; i < 5; i++) record({ kind: 'text', text: `row ${i}` } as AgentEvent)
    expect(svc.changes(id, head.cursor, head.lastSeq, 3).reset).toBe(true)
    expect(svc.changes(id, head.cursor, head.lastSeq, 10).reset).toBe(false)
  })

  it('also bounds a change set by its serialized size', async () => {
    const { svc, id, record } = await start()
    const head = svc.changes(id, 0, 0)
    record({ kind: 'text', text: 'x'.repeat(5000) } as AgentEvent)
    expect(svc.changes(id, head.cursor, head.lastSeq, 2000, 1000).reset).toBe(true)
    expect(svc.changes(id, head.cursor, head.lastSeq, 2000, 100_000).reset).toBe(false)
  })

  it('gives rows saved before the upgrade a baseline so their first read is a clean snapshot', () => {
    db.exec(`INSERT INTO agent_sessions (id, task_id, provider, cwd, additional_dirs, covers, state, created_at)
      VALUES ('old', 't', 'codex', '/w', '[]', '[]', 'idle', 0);
      INSERT INTO agent_events (session_id, seq, event) VALUES ('old', 1, '{"kind":"user","text":"hi"}');`)
    const svc = new AgentService(db, () => {}, fakeQuery)
    const result = svc.changes('old', 0, 0)
    expect(result).toMatchObject({ reset: true, lastSeq: 1 })
    expect(result.events).toHaveLength(1)
  })

  it('answers queue and latest-kind questions from the index, and lists every task at once', async () => {
    const { svc, id, record } = await start()
    const store = (svc as unknown as { parts: { store: import('../src/agent/sessionStore').SessionStore } }).parts.store
    expect(store.queued(id)).toEqual([])
    record({ kind: 'queue', messages: [{ id: 'a', text: 'first', mode: 'queue' }] })
    record({ kind: 'queue', messages: [{ id: 'b', text: 'second', mode: 'queue' }], paused: true })
    record({ kind: 'error', message: 'later row' })
    expect(store.queued(id).map((message) => message.id)).toEqual(['b'])
    expect(store.queuePaused(id)).toBe(true)
    expect(store.latestEvent(id, 'user', 'error')?.kind).toBe('error')
    expect(
      svc
        .listByTask()
        .get('t')
        ?.map((session) => session.id),
    ).toEqual(svc.list('t').map((session) => session.id))
    const plan = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT event FROM agent_events WHERE session_id = 'x' AND json_extract(event, '$.kind') IN ('queue') ORDER BY seq DESC LIMIT 1",
      )
      .all() as { detail: string }[]
    expect(plan.map((row) => row.detail).join(' ')).toContain('agent_events_kind')
  })

  it('reads the end of a long transcript from a turn, within its bounds', async () => {
    const { svc, id, record } = await start()
    expect(svc.tail(id).complete).toBe(true)
    for (let turn = 0; turn < 40; turn++) {
      record({ kind: 'user', text: `turn ${turn}` })
      record({ kind: 'text', text: 'x'.repeat(100) })
    }
    const tail = svc.tail(id, 30)
    expect(tail.complete).toBe(false)
    expect(tail.events[0]!.event.kind).toBe('user')
    expect(tail.events.length).toBeLessThanOrEqual(30)
    expect(tail.events.at(-1)!.seq).toBe(Math.max(...svc.changes(id, 0, 0).events.map((row) => row.seq)))
    expect(svc.tail(id, 300, 1).events.length).toBeLessThanOrEqual(1)
  })
})
