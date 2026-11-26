import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { RecapService } from '../src/memory/recaps'
import { DEFAULT_APP_PREFERENCES, NO_PROJECT } from '@ramu/shared/types'
import type { AgentService } from '../src/agent'
import { systemTimezone } from '@ramu/shared/workspace/timezone'
vi.mock('@ramu/shared/workspace/timezone', () => ({ systemTimezone: vi.fn(() => 'UTC') }))
let db: Db,
  dir: string,
  ws: Workspace,
  service: RecapService,
  taskId: string,
  analyze: ReturnType<typeof vi.fn>,
  digest: ReturnType<typeof vi.fn>
const item = (extra = {}) => ({
  key: 'unfinished',
  group: 'attention',
  title: 'Finish the change',
  detail: 'One caller still needs updating',
  taskId,
  sessionId: 'session',
  sourceSeq: 2,
  ...extra,
})
beforeEach(async () => {
  vi.mocked(systemTimezone).mockReturnValue('UTC')
  dir = mkdtempSync(join(tmpdir(), 'ramu-recap-'))
  db = openDb(':memory:')
  ws = new Workspace(db, join(dir, 'worktrees'))
  taskId = (await ws.createTask({ projectId: NO_PROJECT, title: 'Thread', mode: 'current' })).id
  db.prepare(
    "INSERT INTO agent_sessions (id,task_id,provider,cwd,state,created_at,settings) VALUES ('session',?,'claude-code',?,'idle',?, '{}')",
  ).run(taskId, dir, Date.now())
  db.prepare("INSERT INTO agent_events (session_id, seq, event) VALUES ('session',1,?)").run(
    JSON.stringify({ kind: 'user', text: 'Update all callers' }),
  )
  db.prepare("INSERT INTO agent_events (session_id, seq, event) VALUES ('session',2,?)").run(
    JSON.stringify({ kind: 'text', text: 'One caller is still unfinished' }),
  )
  analyze = vi.fn(async () => ({ message: JSON.stringify({ items: [item()] }) }))
  const agents = { list: () => [{ id: 'session', state: 'idle' }], analyze } as unknown as AgentService
  digest = vi.fn()
  service = new RecapService(db, ws, agents, () => {}, digest as unknown as () => void)
})
it('uses the current OS timezone for daily timing', async () => {
  ws.setAppState('app-preferences', { recapsEnabled: true, recapTime: '08:00' })
  ws.setAppState('recap-generated-at', Date.parse('2026-01-01T13:00:00Z'))
  vi.mocked(systemTimezone).mockReturnValue('America/New_York')
  await service.tick(Date.parse('2026-01-02T08:30:00Z')) // 03:30 in the OS zone
  expect(analyze).not.toHaveBeenCalled()
  vi.mocked(systemTimezone).mockReturnValue('Asia/Jakarta') // OS zone changed while service stays running
  await service.tick(Date.parse('2026-01-02T08:30:00Z')) // 15:30, after the configured time
  expect(analyze).toHaveBeenCalledTimes(1)
})
it('writes the recap with the background model when one is chosen', async () => {
  const maintenanceModel = { provider: 'codex', model: 'gpt-mini', effort: 'low' }
  ws.setAppState('app-preferences', { recapsEnabled: true, intelligence: { maintenanceModel } })
  await service.refresh()
  expect(analyze.mock.calls[0]![1]).toMatchObject(maintenanceModel)
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})
it('is enabled by default and produces source-linked items', async () => {
  expect(DEFAULT_APP_PREFERENCES.recapsEnabled).toBe(true)
  const result = await service.refresh()
  expect(result.items[0]).toMatchObject({ taskId, sessionId: 'session', sourceSeq: 2, status: 'open' })
})
it('deduplicates and preserves user resolution on refresh', async () => {
  const first = await service.refresh()
  service.act(first.items[0]!.id, 'done')
  const second = await service.refresh()
  expect(second.items).toHaveLength(1)
  expect(second.items[0]?.id).toBe(first.items[0]?.id)
  expect(second.items[0]?.status).toBe('done')
})
it('snoozes for a day by default, until a chosen time, and can be undone', async () => {
  const [first] = (await service.refresh()).items
  const now = Date.parse('2026-01-02T10:00:00Z')
  service.act(first!.id, 'snoozed', undefined, now)
  expect(service.snapshot().items[0]).toMatchObject({ status: 'snoozed', snoozedUntil: now + 86_400_000 })
  service.act(first!.id, 'snoozed', now + 3 * 3_600_000, now)
  expect(service.snapshot().items[0]?.snoozedUntil).toBe(now + 3 * 3_600_000)
  service.act(first!.id, 'open')
  expect(service.snapshot().items[0]).toMatchObject({ status: 'open', snoozedUntil: null })
})
it('rejects snooze times in the past or more than 30 days away, and ignores a time for other actions', async () => {
  const [first] = (await service.refresh()).items
  const now = Date.parse('2026-01-02T10:00:00Z')
  expect(() => service.act(first!.id, 'snoozed', now - 1, now)).toThrow('30 days')
  expect(() => service.act(first!.id, 'snoozed', now + 31 * 86_400_000, now)).toThrow('30 days')
  expect(service.snapshot().items[0]?.status).toBe('open')
  service.act(first!.id, 'done', now + 5000, now)
  expect(service.snapshot().items[0]).toMatchObject({ status: 'done', snoozedUntil: null })
})
it('does not accept nonexistent source events or unsupported resolution evidence', async () => {
  analyze.mockResolvedValue({ message: JSON.stringify({ items: [item({ sourceSeq: 999 })] }) })
  expect((await service.refresh()).items).toHaveLength(0)
  analyze.mockResolvedValue({ message: JSON.stringify({ items: [item()] }) })
  const first = await service.refresh()
  analyze.mockResolvedValue({
    message: JSON.stringify({
      items: [],
      resolved: [{ key: first.items[0]!.key, sessionId: 'session', sourceSeq: 2 }],
    }),
  })
  expect((await service.refresh()).items[0]?.status).toBe('open')
})
it('reconciles later completion evidence and respects the off switch', async () => {
  const first = await service.refresh()
  db.prepare("INSERT INTO agent_events (session_id, seq, event) VALUES ('session',3,?)").run(
    JSON.stringify({ kind: 'text', text: 'All callers updated and tested' }),
  )
  analyze.mockResolvedValue({
    message: JSON.stringify({
      items: [],
      resolved: [{ key: first.items[0]!.key, sessionId: 'session', sourceSeq: 3 }],
    }),
  })
  expect((await service.refresh()).items[0]?.status).toBe('done')
  ws.setAppState('app-preferences', { recapsEnabled: false })
  await service.tick()
  await expect(service.refresh()).rejects.toThrow('Enable recaps')
  expect(analyze).toHaveBeenCalledTimes(2)
})
it('discards an in-flight recap when recaps are turned off', async () => {
  let release!: (value: { message: string }) => void
  analyze.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const generating = service.refresh()
  ws.setAppState('app-preferences', { recapsEnabled: false })
  service.settingsChanged()
  release({ message: JSON.stringify({ items: [item()] }) })
  await generating
  expect(service.snapshot().items).toHaveLength(0)
})

it('cancels recap generation, ignores a late result and permits manual retry', async () => {
  let release!: (value: { message: string }) => void
  let signal!: AbortSignal
  analyze.mockImplementationOnce((_prompt, _settings, _length, options) => {
    signal = options.signal
    return new Promise((resolve) => {
      release = resolve
    })
  })
  const running = service.refresh()
  service.cancel()
  expect(signal.aborted).toBe(true)
  release({ message: JSON.stringify({ items: [item()] }) })
  await running
  expect(service.snapshot()).toMatchObject({ generating: false, error: null, generatedAt: null, items: [] })
  await service.tick()
  expect(analyze).toHaveBeenCalledTimes(1)
  await service.refresh()
  expect(service.snapshot().items).toHaveLength(1)
})
it('does not call the model again until the thread or the model changes, and always retries a failure', async () => {
  ws.setAppState('app-preferences', { recapsEnabled: true, recapTime: '08:00' })
  analyze.mockRejectedValueOnce(new Error('offline'))
  await service.refresh(false)
  expect(service.snapshot().error).toContain('offline')
  await service.refresh(false)
  expect(analyze).toHaveBeenCalledTimes(2)
  await service.refresh(false)
  expect(analyze).toHaveBeenCalledTimes(2)
  expect(service.snapshot().generatedAt).toBeTypeOf('number')
  db.prepare("INSERT INTO agent_events (session_id, seq, event) VALUES ('session',3,?)").run(
    JSON.stringify({ kind: 'text', text: 'Done now' }),
  )
  await service.refresh(false)
  expect(analyze).toHaveBeenCalledTimes(3)
  await service.refresh()
  expect(analyze).toHaveBeenCalledTimes(4)
})

it('announces the daily recap once a day, only for the scheduled run and only when it produced items', async () => {
  ws.setAppState('app-preferences', { recapsEnabled: true, recapTime: '08:00' })
  const addEvent = (seq: number) =>
    db
      .prepare("INSERT INTO agent_events (session_id, seq, event) VALUES ('session',?,?)")
      .run(seq, JSON.stringify({ kind: 'text', text: `More work ${seq}` }))
  await service.refresh() // the user pressed Refresh: they are already looking
  expect(digest).not.toHaveBeenCalled()
  addEvent(3)
  await service.refresh(false)
  expect(digest).toHaveBeenCalledTimes(1)
  addEvent(4)
  await service.refresh(false) // a second run the same day stays quiet
  expect(digest).toHaveBeenCalledTimes(1)
  ws.setAppState('recap-digest-day', '2000-01-01') // the next day
  addEvent(5)
  await service.refresh(false)
  expect(digest).toHaveBeenCalledTimes(2)
})
it('does not announce a daily run that produced nothing', async () => {
  analyze.mockResolvedValue({ message: JSON.stringify({ items: [], resolved: [] }) })
  await service.refresh(false)
  expect(digest).not.toHaveBeenCalled()
})
