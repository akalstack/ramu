import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Deployment } from '@ramu/shared/types/deploy'
import { DeployWatches } from '../src/workspace/deploy/deployWatch'
import { ProjectWake } from '../src/workspace/deploy/wake'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function checkout(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-deploy-watch-'))
  dirs.push(dir)
  execFileSync('git', ['init', '-q', '-b', 'main', dir])
  return dir
}

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

const deployment = (patch: Partial<Deployment>): Deployment => ({
  id: 'd1',
  state: 'building',
  url: 'https://shop-abc.vercel.app',
  production: true,
  ref: 'main',
  commit: SHA,
  message: 'Add booking',
  createdAt: Date.now(),
  ...patch,
})

function setup(options: { lists?: Deployment[][]; statuses?: Deployment[]; log?: string; migrate?: string | null }) {
  const cwd = checkout()
  const state = new Map<string, unknown>()
  const sessions = [
    { id: 'pusher', taskId: 't1', cwd, state: 'idle', parentId: null },
    { id: 'recent', taskId: 't2', cwd, state: 'idle', parentId: null },
  ]
  const tasks = [
    { id: 't1', projectId: 'p1', status: 'active', lastActiveAt: 1 },
    { id: 't2', projectId: 'p1', status: 'active', lastActiveAt: 2 },
  ]
  const enqueueBackground = vi.fn()
  const workspace = {
    getAppState: <T>(key: string, fallback: T) => (state.get(key) as T) ?? fallback,
    setAppState: (key: string, value: unknown) => void state.set(key, value),
    getTask: (id: string) => tasks.find((task) => task.id === id)!,
    listTasks: () => tasks,
  }
  const wake = new ProjectWake(
    { exec: () => {} },
    workspace as never,
    {
      get: (id: string) => sessions.find((session) => session.id === id)!,
      list: (taskId: string) => sessions.filter((session) => session.taskId === taskId),
      enqueueBackground,
    } as never,
  )
  const service = {
    binding: () => ({ platform: 'vercel' }) as never,
    project: vi.fn(async () => ({
      productionUrl: 'https://shop.example.com',
      deployments: options.lists?.length ? options.lists.shift()! : [],
    })) as never,
    deployment: vi.fn(async () => options.statuses?.shift() ?? deployment({})),
    logs: vi.fn(async () => options.log ?? ''),
  }
  const watches = new DeployWatches(
    {
      getState: workspace.getAppState,
      setState: workspace.setAppState,
      migrate: () => options.migrate ?? null,
    },
    wake,
    service,
  )
  return { watches, enqueueBackground, sessions, state, service }
}

async function poll(watches: DeployWatches, times: number, start = Date.now()) {
  let now = start
  for (let i = 0; i < times; i++) await watches.tick((now += 31_000))
}

describe('deploy watches', () => {
  it('wakes the thread that deployed once the deployment is ready, with the live address', async () => {
    const { watches, enqueueBackground } = setup({
      statuses: [deployment({}), deployment({ state: 'ready' }), deployment({ state: 'ready' })],
    })
    watches.follow('p1', { id: 'd1', production: true }, 'pusher')
    await poll(watches, 3)
    expect(enqueueBackground).toHaveBeenCalledTimes(1)
    expect(enqueueBackground.mock.calls[0]?.[0]).toBe('pusher')
    expect(enqueueBackground.mock.calls[0]?.[1]).toContain('https://shop.example.com is live')
  })

  it('hands over the end of a failed build log with secrets redacted', async () => {
    const { watches, enqueueBackground } = setup({
      statuses: [deployment({ state: 'failed', production: false })],
      log: 'Installing\nError: missing STRIPE_KEY=sk_live_abcdefghijklmnopqrstuvwxyz\nBuild failed',
    })
    watches.follow('p1', { id: 'd1', production: false }, null)
    await poll(watches, 1)
    const text = enqueueBackground.mock.calls[0]?.[1] as string
    expect(enqueueBackground.mock.calls[0]?.[0]).toBe('recent')
    expect(text).toContain('The preview deployment of main (a1b2c3d) failed')
    expect(text).toContain('Build failed')
    expect(text).toContain('[redacted]')
    expect(text).not.toContain('sk_live_abcdefghijklmnopqrstuvwxyz')
  })

  it('finds the platform’s deployment of a push by its commit, and says migrations were not run', async () => {
    const other = deployment({ id: 'd0', commit: 'f'.repeat(40), state: 'ready' })
    const { watches, enqueueBackground } = setup({
      lists: [
        [other],
        [deployment({ id: 'd2', state: 'building' }), other],
        [deployment({ id: 'd2', state: 'ready' })],
      ],
      migrate: 'uv run manage.py migrate',
    })
    watches.followPush('p1', SHA.toUpperCase(), 'pusher')
    await poll(watches, 3)
    expect(enqueueBackground).toHaveBeenCalledTimes(1)
    const text = enqueueBackground.mock.calls[0]?.[1] as string
    expect(text).toContain('which the platform started for the push')
    expect(text).toContain('did not run the migrate command (uv run manage.py migrate)')
  })

  it('follows a merge as the next production deployment, and forgets a push the platform never deploys', async () => {
    const before = deployment({ id: 'old', state: 'ready', createdAt: Date.now() - 10 * 60_000 })
    const merged = setup({ lists: [[deployment({ id: 'd3', state: 'ready', commit: null }), before]] })
    merged.watches.followPush('p1', null, null)
    await poll(merged.watches, 1)
    expect(merged.enqueueBackground.mock.calls[0]?.[1]).toContain('The production deployment of main')

    const ignored = setup({ lists: [] })
    ignored.watches.followPush('p1', SHA, 'pusher')
    await poll(ignored.watches, 1, Date.now() + 21 * 60_000)
    expect(ignored.state.get('deploy-watches')).toEqual([])
    expect(ignored.enqueueBackground).not.toHaveBeenCalled()
  })

  it('tells the pushing thread its branch’s preview address, found by the pushed commit', async () => {
    const preview = deployment({
      id: 'pv',
      state: 'ready',
      production: false,
      ref: 'feature',
      commit: SHA,
      url: 'https://shop-git-feature.vercel.app',
    })
    const { watches, enqueueBackground } = setup({
      lists: [[deployment({ id: 'other', production: false, commit: 'f'.repeat(40) })], [preview]],
    })
    watches.followPreview('p1', 'feature', SHA, 'pusher')
    await poll(watches, 2)
    expect(enqueueBackground).toHaveBeenCalledTimes(1)
    const text = enqueueBackground.mock.calls[0]?.[1] as string
    expect(text).toContain('The preview deployment of feature (a1b2c3d)')
    expect(text).toContain('https://shop-git-feature.vercel.app is live')
    expect(text).not.toContain('migrate')
  })

  it('wakes the project’s latest thread when the one that deployed was stopped', async () => {
    const { watches, enqueueBackground, sessions } = setup({ statuses: [deployment({ state: 'ready' })] })
    watches.follow('p1', { id: 'd1', production: true }, 'pusher')
    sessions[0]!.state = 'stopped'
    await poll(watches, 1)
    expect(enqueueBackground.mock.calls.map((call) => call[0])).toEqual(['recent'])
  })
})
