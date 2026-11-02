import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_APP_PREFERENCES, type AgentEvent, type ChatGoal } from '@ramu/shared/types'
import { AgentService, type QueryFn } from '../src/agent'
import { openDb, type Db } from '../src/db'

let dir: string, path: string, db: Db | undefined
const goal = (patch: Partial<ChatGoal> = {}): ChatGoal => ({
  id: 'g1',
  objective: 'Login',
  status: 'active',
  turns: 2,
  reason: '',
  updatedAt: 1,
  ...patch,
})

beforeEach(() => {
  vi.useFakeTimers()
  dir = mkdtempSync(join(tmpdir(), 'ramu-goal-migration-'))
  path = join(dir, 'ramu.db')
})
afterEach(() => {
  db?.close()
  db = undefined
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

/** A database as the release before the merge left it: goal events with the retired status, schema before the goal-status migration. */
function legacyDb(events: ChatGoal[]): Db {
  const fresh = openDb(path)
  fresh.exec(
    "INSERT INTO projects (id, name, created_at) VALUES ('p', 'Project', 0); INSERT INTO tasks (id, project_id, title, mode, status, created_at) VALUES ('t', 'p', 'Task', 'current', 'idle', 0); INSERT INTO agent_sessions (id, task_id, provider, cwd, state, created_at) VALUES ('s', 't', 'codex', '/tmp', 'idle', 0)",
  )
  const insert = fresh.prepare('INSERT INTO agent_events (session_id, seq, event) VALUES (?, ?, ?)')
  events.forEach((value, i) =>
    insert.run('s', i + 1, JSON.stringify({ kind: 'goal', goal: value } satisfies AgentEvent)),
  )
  fresh.exec('DROP TABLE interactive_previews; DROP TABLE interactive_versions')
  // v21 predates the goal-status migration; later migrations must not move this fixture forward.
  fresh.exec('PRAGMA user_version = 21')
  fresh.close()
  return openDb(path)
}

const stored = (d: Db) =>
  (
    d.prepare("SELECT event FROM agent_events WHERE json_extract(event, '$.kind') = 'goal' ORDER BY seq").all() as {
      event: string
    }[]
  ).map((row) => JSON.parse(row.event).goal as ChatGoal)

it('rewrites goals saved with the retired status and leaves every other goal alone', () => {
  db = legacyDb([
    goal(),
    goal({ status: 'waiting-provider', retryAt: 99, retryDelay: 60_000, reason: 'Waiting' }),
    goal({ status: 'paused' }),
    goal({ id: 'g2', status: 'blocked', reason: 'Needs a key' }),
  ])
  const [active, held, paused, blocked] = stored(db)
  expect(active).toEqual(goal())
  // Everything else on the goal survives; only the status changes and the holder is recorded.
  expect(held).toEqual(
    goal({ status: 'paused', pausedBy: 'provider-limit', retryAt: 99, retryDelay: 60_000, reason: 'Waiting' }),
  )
  // A paused goal from before the merge was always the user's: it stays without a holder, and reads as the user's.
  expect(paused).toEqual(goal({ status: 'paused' }))
  expect(paused?.pausedBy).toBeUndefined()
  expect(blocked).toMatchObject({ id: 'g2', status: 'blocked' })
})

it('does not touch the data again on the next start', () => {
  db = legacyDb([goal({ status: 'waiting-provider' })])
  const once = stored(db)
  db.close()
  db = openDb(path)
  expect(stored(db)).toEqual(once)
})

it('keeps a goal held at a limit before the upgrade resuming after it', async () => {
  db = legacyDb([goal({ status: 'waiting-provider', retryAt: Date.now() + 30_000 })])
  const prompts: string[] = []
  const service = new AgentService(
    db,
    () => {},
    (() => {
      throw new Error('Unexpected inference')
    }) as QueryFn,
    (_scope, _settings, callback) => ({
      start: async (prompt: string) => {
        prompts.push(prompt)
        callback({ kind: 'init', providerSessionId: 'thread', model: 'fake', cwd: '/tmp' })
        callback({ kind: 'state', state: 'running' })
      },
      send: async (prompt: string) => void prompts.push(prompt),
      steer: async () => {},
      interrupt: async () => {},
      stop: async () => {},
      replyPermission: () => {},
      replyQuestion: () => {},
    }),
  )
  service.preferences = () => structuredClone(DEFAULT_APP_PREFERENCES)
  expect(service.getGoal('s')).toMatchObject({ status: 'paused', pausedBy: 'provider-limit', objective: 'Login' })
  service.goalsSettingsChanged()
  await vi.advanceTimersByTimeAsync(31_000)
  // The held goal was re-armed from the migrated event and sent its retry, as it would have before.
  expect(prompts.length).toBeGreaterThan(0)
  expect(service.getGoal('s')?.status).toBe('active')
  service.stopAll()
})
