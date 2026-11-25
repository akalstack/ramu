import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import type { AgentService } from '../src/agent'
import { ShipService } from '../src/background/ship'

let db: Db, ws: Workspace, ship: ShipService, root: string, checkout: string
let enqueue: ReturnType<typeof vi.fn>
const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
const commit = (file: string, text: string) => {
  writeFileSync(join(checkout, file), text)
  run(checkout, 'add', file)
  run(checkout, 'commit', '-q', '-m', `Change ${file}`)
}
const url = 'https://github.com/ana/shop/pull/7'
const watch = () => ({ sessionId: 'session', cwd: checkout, branch: 'fix', url })

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'ramu-ship-undo-'))
  const remote = join(root, 'remote.git')
  checkout = join(root, 'checkout')
  run(root, 'init', '-q', '--bare', remote)
  run(root, 'init', '-q', '-b', 'fix', checkout)
  run(checkout, 'config', 'user.email', 'test@example.com')
  run(checkout, 'config', 'user.name', 'Test')
  run(checkout, 'remote', 'add', 'origin', remote)
  commit('app.ts', 'broken\n')
  run(checkout, 'push', '-q', '-u', 'origin', 'fix')
  db = openDb(':memory:')
  ws = new Workspace(db, join(root, 'data'))
  vi.spyOn(ws, 'getTask').mockReturnValue({
    id: 'task',
    projectId: 'p',
    title: 'Fix login',
    status: 'idle',
  } as ReturnType<Workspace['getTask']>)
  enqueue = vi.fn()
  const session = {
    id: 'session',
    taskId: 'task',
    state: 'idle',
    covers: [checkout],
    parentId: null,
  } as AgentSessionInfo
  const agents = { get: () => session, enqueueBackground: enqueue } as unknown as AgentService
  ship = new ShipService(
    ws,
    agents,
    { watch: async () => {}, status: () => ({ sessionId: null, threads: [] }) },
    { liveAddress: () => null, viewer: () => null },
    () => {},
  )
  // A shipping thread, its checks round handed over, then the fix the agent pushes.
  ws.setAppState('ship-runs', [
    {
      id: 'run',
      sessionId: 'session',
      taskId: 'task',
      finishLine: 'review',
      limits: { maxCiFixes: 3, maxReviewRounds: 5 },
      rounds: { checks: 0, reviews: 0 },
      watched: [],
      told: {},
    },
  ])
  ship.after(watch(), 'checks')
  await vi.waitFor(() =>
    expect(ws.getAppState<{ pendingFix?: unknown }[]>('ship-runs', [])[0]?.pendingFix).toBeTruthy(),
  )
  commit('app.ts', 'fixed\n')
  run(checkout, 'push', '-q')
  await ship.pushed('session', checkout)
})
afterEach(() => {
  db.close()
  rmSync(root, { recursive: true, force: true })
})

it('lists the fix it pushed unasked, and undoes it with a pushed revert the thread hears about', async () => {
  const [entry] = ship.activity()
  expect(entry).toMatchObject({ kind: 'checks-fixed', title: 'Fix login', url, number: 7 })
  const listed = await ship.undo(entry!.id)
  expect(listed[0]!.undoneAt).toBeTypeOf('number')
  expect(run(checkout, 'show', 'HEAD:app.ts')).toBe('broken')
  expect(run(checkout, 'log', '-1', '--format=%s')).toMatch(/^Revert/)
  // The revert is on the remote too, not only in the checkout.
  expect(run(checkout, 'rev-parse', 'HEAD')).toBe(run(checkout, 'rev-parse', 'origin/fix'))
  expect(enqueue.mock.calls[0]![1]).toMatch(/undid the fix/)
})

it('leaves a fix alone once the branch has moved on or the checkout has changes', async () => {
  const [entry] = ship.activity()
  writeFileSync(join(checkout, 'app.ts'), 'edited\n')
  await expect(ship.undo(entry!.id)).rejects.toThrow(/not committed/)
  run(checkout, 'checkout', '--', 'app.ts')
  commit('other.ts', 'more\n')
  await expect(ship.undo(entry!.id)).rejects.toThrow(/moved on/)
  expect(run(checkout, 'show', 'HEAD:app.ts')).toBe('fixed')
})

it('takes the revert back when it cannot be pushed, so Undo can be tried again', async () => {
  const [entry] = ship.activity()
  run(checkout, 'remote', 'set-url', 'origin', join(root, 'missing.git'))
  await expect(ship.undo(entry!.id)).rejects.toThrow()
  expect(run(checkout, 'show', 'HEAD:app.ts')).toBe('fixed')
  expect(ship.activity()[0]!.undoneAt).toBeUndefined()
})

it('never counts the person’s own pushed commits as Ship’s fix', async () => {
  ship.after(watch(), 'checks')
  await vi.waitFor(() =>
    expect(ws.getAppState<{ pendingFix?: unknown }[]>('ship-runs', [])[0]?.pendingFix).toBeTruthy(),
  )
  commit('notes.md', 'mine\n')
  run(checkout, 'push', '-q')
  await ship.personPushed(checkout)
  commit('app.ts', 'fixed again\n')
  await ship.pushed('session', checkout)
  const latest = ship.activity()[0]!
  expect(run(checkout, 'log', '--format=%s', `${latest.from}..${latest.to}`)).toBe('Change app.ts')
})
