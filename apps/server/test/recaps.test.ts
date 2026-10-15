import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { RecapService } from '../src/memory/recaps'
import { DEFAULT_APP_PREFERENCES, NO_PROJECT } from '@ramu/shared/types'
import type { AgentService } from '../src/agent'
import { systemTimezone } from '@ramu/shared/timezone'
vi.mock('@ramu/shared/timezone', () => ({ systemTimezone: vi.fn(() => 'UTC') }))
let db: Db, dir: string, ws: Workspace, service: RecapService, taskId: string, analyze: ReturnType<typeof vi.fn>
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
  taskId = (await ws.createTask({ projectId: NO_PROJECT, title: 'Chat', mode: 'current' })).id
  db.prepare(
    "INSERT INTO agent_sessions (id,task_id,provider,cwd,state,created_at,settings) VALUES ('session',?,'claude-code',?,'idle',?, '{}')",
  ).run(taskId, dir, Date.now())
  db.prepare("INSERT INTO agent_events VALUES ('session',1,?)").run(
    JSON.stringify({ kind: 'user', text: 'Update all callers' }),
  )
  db.prepare("INSERT INTO agent_events VALUES ('session',2,?)").run(
    JSON.stringify({ kind: 'text', text: 'One caller is still unfinished' }),
  )
  analyze = vi.fn(async () => ({ message: JSON.stringify({ items: [item()] }) }))
  const agents = { list: () => [{ id: 'session', state: 'idle' }], analyze } as unknown as AgentService
  service = new RecapService(db, ws, agents, () => {})
})
it('uses the current OS timezone for daily timing instead of a legacy override', async () => {
  ws.setAppState('app-preferences', { recapsEnabled: true, recapTime: '08:00', timezone: 'UTC' })
  ws.setAppState('recap-generated-at', Date.parse('2026-01-01T13:00:00Z'))
  vi.mocked(systemTimezone).mockReturnValue('America/New_York')
  await service.tick(Date.parse('2026-01-02T08:30:00Z')) // 03:30 in the OS zone
  expect(analyze).not.toHaveBeenCalled()
  vi.mocked(systemTimezone).mockReturnValue('Asia/Jakarta') // OS zone changed while service stays running
  await service.tick(Date.parse('2026-01-02T08:30:00Z')) // 15:30, after the configured time
  expect(analyze).toHaveBeenCalledTimes(1)
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
  db.prepare("INSERT INTO agent_events VALUES ('session',3,?)").run(
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
