import { createHmac } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import type { RepoHook, RepoHookConfig } from '../src/workspace/forge/github'
import {
  LivePullRequests,
  LIVE_PULL_REQUEST_EVENTS,
  type LivePullRequestHost,
} from '../src/background/livePullRequests'

const setup = (options: { url?: string | null; repos?: { name: string; root: string }[] } = {}) => {
  const state = new Map<string, unknown>()
  let url: string | null = options.url === undefined ? 'https://me.akalstack.com' : options.url
  const host = {
    getState: <T>(key: string, fallback: T) => (state.has(key) ? (structuredClone(state.get(key)) as T) : fallback),
    setState: (key: string, value: unknown) => void state.set(key, structuredClone(value)),
    repositories: () => options.repos ?? [{ name: 'app', root: '/work/app' }],
    githubRepository: async (root: string) =>
      root === '/work/notes' ? null : { origin: 'github.com', owner: 'acme', repo: root.split('/').pop()! },
    publicUrl: () => url,
    create: vi.fn(async (_root: string, _config: RepoHookConfig): Promise<RepoHook> => ({
      origin: 'github.com',
      owner: 'acme',
      repo: 'app',
      id: 7,
    })),
    update: vi.fn(async (_root: string, _hook: RepoHook, _config: RepoHookConfig) => {}),
    remove: vi.fn(async (_root: string, _hook: RepoHook) => {}),
    readToken: async () => 'gh-token',
    changed: vi.fn(),
    statusChanged: vi.fn(),
  } satisfies LivePullRequestHost
  return { live: new LivePullRequests(host), host, setUrl: (next: string | null) => (url = next) }
}
const sign = (secret: string, body: Buffer) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
const hookOf = (host: ReturnType<typeof setup>['host']) => host.create.mock.calls[0]![1]!

it('adds a webhook to each GitHub repository when turned on, and only then', async () => {
  const { live, host } = setup({
    repos: [
      { name: 'app', root: '/work/app' },
      { name: 'notes', root: '/work/notes' },
    ],
  })
  await live.sync()
  expect(host.create).not.toHaveBeenCalled()
  const status = await live.setEnabled(true)
  expect(host.create).toHaveBeenCalledOnce()
  const config = hookOf(host)
  expect(config.url).toMatch(/^https:\/\/me\.akalstack\.com\/hooks\/pr\/[A-Za-z0-9_-]{20,}$/)
  expect(config.events).toEqual([...LIVE_PULL_REQUEST_EVENTS])
  expect(status).toMatchObject({ enabled: true, reachable: true, repos: [{ name: 'acme/app', state: 'live' }] })
})

it('acts on a delivery GitHub signed, and refuses one it did not', async () => {
  const { live, host } = setup()
  await live.setEnabled(true)
  const { url, secret } = hookOf(host)
  const token = url.split('/').pop()!
  const body = Buffer.from('{"action":"completed"}')
  expect(live.receive(token, { 'x-github-event': 'check_run', 'x-hub-signature-256': 'sha256=bad' }, body).status).toBe(
    401,
  )
  expect(host.changed).not.toHaveBeenCalled()
  const signed = { 'x-github-event': 'check_run', 'x-hub-signature-256': sign(secret, body) }
  expect(live.receive(token, signed, body).status).toBe(202)
  expect(host.changed).toHaveBeenCalledWith('/work/app')
  expect(live.receive('unknown-token-unknown-token', signed, body).status).toBe(404)
  // GitHub's ping when the hook is added proves the address without reading anything again.
  const ping = Buffer.from('{}')
  expect(
    live.receive(token, { 'x-github-event': 'ping', 'x-hub-signature-256': sign(secret, ping) }, ping).status,
  ).toBe(204)
  expect(host.changed).toHaveBeenCalledOnce()
  expect(live.status().repos[0]!.lastDelivery).not.toBeNull()
})

it('says what is missing: a public address, or admin rights on the repository', async () => {
  const { live, host, setUrl } = setup({ url: null })
  expect(await live.setEnabled(true)).toMatchObject({
    reachable: false,
    repos: [{ state: 'problem', problem: 'no-address' }],
  })
  expect(host.create).not.toHaveBeenCalled()
  setUrl('https://me.akalstack.com')
  host.create.mockRejectedValueOnce(new Error('gh api failed: Not Found (HTTP 404)'))
  await live.sync()
  expect(live.status().repos[0]).toMatchObject({ state: 'problem', problem: 'needs-admin' })
  await live.sync()
  expect(live.status().repos[0]!.state).toBe('live')
})

it('points the webhook at a new address, and removes it when turned off', async () => {
  const { live, host, setUrl } = setup()
  await live.setEnabled(true)
  setUrl('https://other.akalstack.com')
  await live.sync()
  expect(host.update).toHaveBeenCalledOnce()
  expect(host.update.mock.calls[0]![2].url).toMatch(/^https:\/\/other\.akalstack\.com\/hooks\/pr\//)
  await live.setEnabled(false)
  expect(host.remove).toHaveBeenCalledOnce()
  expect(live.status()).toMatchObject({ enabled: false, repos: [] })
})

it('uses the GitHub App where it is installed, with no webhook, and a webhook only where it is not', async () => {
  const appStates: Record<string, 'live' | 'not-installed'> = { 'acme/app': 'not-installed' }
  const app = {
    start: vi.fn(),
    stop: vi.fn(),
    state: () => 'connected' as const,
    repoState: (repo: string) => appStates[repo.toLowerCase()],
  }
  const { host } = setup()
  const withApp = new LivePullRequests({ ...host, app })
  await withApp.setEnabled(true)
  expect(app.start).toHaveBeenCalled()
  expect(withApp.status().repos[0]).toMatchObject({ state: 'live', source: 'webhook', app: 'not-installed' })
  appStates['acme/app'] = 'live'
  await withApp.sync()
  expect(host.remove).toHaveBeenCalledOnce()
  expect(withApp.status()).toMatchObject({ app: 'connected', repos: [{ state: 'live', source: 'app' }] })
  expect(await withApp.watched()).toEqual([{ token: 'gh-token', repos: ['acme/app'] }])
  withApp.appEvent('acme/app')
  expect(host.changed).toHaveBeenCalledWith('/work/app')
  await withApp.setEnabled(false)
  expect(app.stop).toHaveBeenCalled()
})

it('keeps the setting a person changes while a sync is running, and syncs again for it', async () => {
  const { live, host } = setup()
  let release!: () => void
  const slow = new Promise<void>((resolve) => (release = resolve))
  const create = host.create.getMockImplementation()!
  host.create.mockImplementationOnce(async (root, config) => {
    await slow
    return create(root, config)
  })
  const on = live.setEnabled(true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  const off = live.setEnabled(false)
  release()
  await Promise.all([on, off])
  expect(live.status().enabled).toBe(false)
  // The sync that follows the change removes the webhook the first one added.
  expect(host.remove).toHaveBeenCalledOnce()
})

it('does not count a repository as covered by the App while the App is not connected', async () => {
  const app = { start: vi.fn(), stop: vi.fn(), state: () => 'unavailable' as const, repoState: () => 'live' as const }
  const { host } = setup()
  const withApp = new LivePullRequests({ ...host, app })
  await withApp.setEnabled(true)
  expect(host.create).toHaveBeenCalledOnce()
  expect(withApp.status().repos[0]).toMatchObject({ source: 'webhook' })
})
