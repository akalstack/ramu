import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DomainStatus } from '@ramu/shared/types/deploy'
import { DomainWatches } from '../src/workspace/deploy/domainWatch'
import { ProjectWake } from '../src/workspace/deploy/wake'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function checkout(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-domain-'))
  dirs.push(dir)
  execFileSync('git', ['init', '-q', '-b', 'main', dir])
  return dir
}

const domain = (configured: boolean, certificate: boolean): DomainStatus => ({
  name: 'www.shop.id',
  records: [],
  configured,
  certificate,
  managedDns: false,
})

function setup(states: DomainStatus[][]) {
  const cwd = checkout()
  const state = new Map<string, unknown>()
  const sessions = [
    { id: 'old', taskId: 't1', cwd, state: 'idle', parentId: null },
    { id: 'recent', taskId: 't2', cwd, state: 'idle', parentId: null },
    { id: 'helper', taskId: 't2', cwd, state: 'idle', parentId: 'recent' },
  ]
  const tasks = [
    { id: 't1', projectId: 'p1', status: 'active', lastActiveAt: 1 },
    { id: 't2', projectId: 'p1', status: 'active', lastActiveAt: 2 },
    { id: 't3', projectId: 'p2', status: 'active', lastActiveAt: 3 },
  ]
  const enqueueBackground = vi.fn()
  const domains = vi.fn(async () => states.shift() ?? [])
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
  const watches = new DomainWatches(workspace as never, wake, { domains })
  return { watches, enqueueBackground, domains, cwd, state }
}

describe('domain watches', () => {
  it('wakes the thread once, when the domain both points at the platform and serves HTTPS', async () => {
    const { watches, enqueueBackground, cwd } = setup([
      [domain(false, false)],
      [domain(true, false)],
      [domain(true, true)],
      [domain(true, true)],
    ])
    watches.watch('p1', 'www.shop.id', 'old')
    let now = Date.now()
    for (let poll = 0; poll < 4; poll++) await watches.tick((now += 61_000))
    expect(enqueueBackground).toHaveBeenCalledTimes(1)
    expect(enqueueBackground).toHaveBeenCalledWith('old', expect.stringContaining('www.shop.id is live'), {
      cwd,
      branch: 'main',
    })
  })

  it('wakes the project’s latest thread when the domain was added from the Deploy sheet', async () => {
    const { watches, enqueueBackground } = setup([[domain(true, true)]])
    watches.watch('p1', 'www.shop.id', null)
    await watches.tick(Date.now())
    expect(enqueueBackground.mock.calls[0]?.[0]).toBe('recent')
  })

  it('stops following a domain removed on the platform, or one still not live after three days', async () => {
    const { watches, enqueueBackground, domains, state } = setup([[]])
    watches.watch('p1', 'www.shop.id', 'old')
    await watches.tick(Date.now())
    expect(state.get('domain-watches')).toEqual([])
    watches.watch('p1', 'www.shop.id', 'old')
    await watches.tick(Date.now() + 73 * 60 * 60_000)
    expect(state.get('domain-watches')).toEqual([])
    expect(domains).toHaveBeenCalledTimes(1)
    expect(enqueueBackground).not.toHaveBeenCalled()
  })
})
