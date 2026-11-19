import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as nodePty from 'node-pty'
import { afterEach, expect, it, vi } from 'vitest'
import { openDb } from '../src/db'
import {
  SqliteBackgroundTerminalHistory,
  type BackgroundTerminalRecord,
} from '../src/workspace/backgroundTerminalHistory'
import { TerminalService } from '../src/workspace/pty'

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close()
})
const until = async (check: () => boolean) => {
  const deadline = Date.now() + 8000
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
function database() {
  const directory = mkdtempSync(join(tmpdir(), 'ramu-background-history-'))
  const path = join(directory, 'history.sqlite')
  let db = openDb(path)
  db.exec(`INSERT INTO projects (id, name, created_at) VALUES ('p', 'Project', 0);
    INSERT INTO tasks (id, project_id, title, mode, status, created_at) VALUES ('a', 'p', 'A', 'current', 'idle', 0), ('b', 'p', 'B', 'current', 'idle', 0);`)
  cleanup.push(() => {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return {
    get db() {
      return db
    },
    reopen() {
      db.close()
      db = openDb(path)
      return db
    },
  }
}
const record = (over: Partial<BackgroundTerminalRecord> = {}): BackgroundTerminalRecord => ({
  id: randomUUID(),
  taskId: 'a',
  repoId: null,
  cwd: tmpdir(),
  command: 'pnpm dev',
  state: 'running',
  startedAt: 1,
  endedAt: null,
  exitCode: null,
  cursor: 5,
  output: 'ready',
  capabilities: { inspect: true, stop: true, forceStop: true, input: true },
  ...over,
})

it('restores only host-owned metadata and a bounded output tail, with no process-control authority', () => {
  const fixture = database()
  const store = new SqliteBackgroundTerminalHistory(fixture.db)
  const original = record({ output: 'x'.repeat(100_000), cursor: 100_000 })
  store.save(original)
  const serialized = fixture.db.prepare('SELECT data FROM background_terminals').get() as { data: string }
  expect(serialized.data).not.toMatch(/"pid"|"env"|"capabilities"/)
  const [restored] = new SqliteBackgroundTerminalHistory(fixture.reopen()).load()
  expect(restored).toMatchObject({
    id: original.id,
    taskId: 'a',
    state: 'unknown',
    cursor: 100_000,
    output: 'x'.repeat(64_000),
    capabilities: { inspect: true, stop: false, forceStop: false, input: false },
  })
})

it('ignores corrupted or misbound records instead of trusting their command identity', () => {
  const fixture = database()
  const original = record()
  fixture.db
    .prepare('INSERT INTO background_terminals (id, task_id, data) VALUES (?, ?, ?)')
    .run(original.id, 'b', JSON.stringify(original))
  fixture.db
    .prepare('INSERT INTO background_terminals (id, task_id, data) VALUES (?, ?, ?)')
    .run(randomUUID(), 'a', '{broken')
  expect(new SqliteBackgroundTerminalHistory(fixture.db).load()).toEqual([])
  const valid = record()
  const store = new SqliteBackgroundTerminalHistory(fixture.db)
  expect(() => store.save(valid)).not.toThrow()
  expect(store.load().map((entry) => entry.id)).toEqual([valid.id])
})

it('bounds settled history without evicting uncertain commands and cascades thread removal', () => {
  const fixture = database()
  const store = new SqliteBackgroundTerminalHistory(fixture.db)
  const uncertain = record({ state: 'unknown', startedAt: 0 })
  store.save(uncertain)
  for (let i = 1; i <= 110; i++) store.save(record({ state: 'exited', endedAt: i, exitCode: 0, startedAt: i }))
  const loaded = store.load()
  expect(loaded).toHaveLength(101)
  expect(loaded.some((entry) => entry.id === uncertain.id)).toBe(true)
  fixture.db.prepare('DELETE FROM tasks WHERE id = ?').run('a')
  expect(store.load()).toEqual([])
})

it.skipIf(process.platform === 'win32')(
  'keeps real command output after restart and never replays a launch or controls a stale handle',
  async () => {
    const fixture = database()
    const first = new TerminalService(
      () => {},
      () => {},
      () => {},
      new SqliteBackgroundTerminalHistory(fixture.db),
    )
    cleanup.push(() => first.closeAll())
    const command = first.launchBackground('a', null, tmpdir(), 'echo before-restart; sleep 300')
    await until(() => first.inspectBackground('a', command.id).output.includes('before-restart'))
    first.closeAll()
    const spawn = vi.spyOn(nodePty, 'spawn')
    const second = new TerminalService(
      () => {},
      () => {},
      () => {},
      new SqliteBackgroundTerminalHistory(fixture.reopen()),
    )
    cleanup.push(() => second.closeAll())
    expect(spawn).not.toHaveBeenCalled()
    spawn.mockRestore()
    expect(second.listBackground('a')[0]).toMatchObject({
      id: command.id,
      state: 'unknown',
      capabilities: { stop: false, input: false },
    })
    expect(second.snapshot(command.id)).toMatchObject({
      output: expect.stringContaining('before-restart'),
      exited: true,
    })
    const kill = vi.spyOn(process, 'kill')
    try {
      expect(() => second.stopBackground('a', command.id)).toThrow(/Unknown background terminal/)
      expect(() => second.write(command.id, 'exit\r')).toThrow(/Unknown terminal/)
      expect(kill).not.toHaveBeenCalled()
    } finally {
      kill.mockRestore()
    }
    expect(second.list('a')).toHaveLength(1)
    expect(second.listBackground('b')).toEqual([])
    expect(() => second.inspectBackground('b', command.id)).toThrow(/Unknown background terminal/)
  },
)

it.skipIf(process.platform === 'win32')(
  'retains known final output across closing its view and restarting',
  async () => {
    const fixture = database()
    const service = new TerminalService(
      () => {},
      () => {},
      () => {},
      new SqliteBackgroundTerminalHistory(fixture.db),
    )
    cleanup.push(() => service.closeAll())
    const command = service.launchBackground('a', null, tmpdir(), 'echo final-output; exit 3')
    await until(() => service.inspectBackground('a', command.id).state === 'failed')
    service.close(command.id)
    expect(service.inspectBackground('a', command.id)).toMatchObject({
      state: 'failed',
      exitCode: 3,
      output: expect.stringContaining('final-output'),
      capabilities: { input: false, stop: false },
    })
    const restored = new TerminalService(
      () => {},
      () => {},
      () => {},
      new SqliteBackgroundTerminalHistory(fixture.reopen()),
    )
    cleanup.push(() => restored.closeAll())
    expect(restored.inspectBackground('a', command.id)).toMatchObject({
      state: 'failed',
      exitCode: 3,
      output: expect.stringContaining('final-output'),
    })
    restored.closeTask('a')
    expect(restored.listBackground('a')).toEqual([])
    expect(new SqliteBackgroundTerminalHistory(fixture.db).load()).toEqual([])
  },
)

it('refuses a managed launch before spawning if ownership cannot be saved', () => {
  const service = new TerminalService(
    () => {},
    () => {},
    () => {},
    {
      load: () => [],
      save: () => {
        throw new Error('disk full')
      },
      removeTask: () => {},
    },
  )
  expect(() => service.launchBackground('a', null, tmpdir(), 'echo must-not-run')).toThrow('disk full')
  expect(service.list('a')).toEqual([])
})
