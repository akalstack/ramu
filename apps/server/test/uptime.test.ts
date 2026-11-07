import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import type { Deployment, ProjectDeployment } from '@ramu/shared/types/deploy'
import { checkedUrl, liveProbe, UPTIME_INTERVAL, UptimeWatches, type ProbeAnswer } from '../src/workspace/deploy/uptime'

const live: Deployment = {
  id: 'dpl_2',
  state: 'ready',
  url: null,
  production: true,
  ref: 'main',
  commit: 'abc',
  message: 'Add booking form',
  createdAt: Date.UTC(2026, 10, 7, 9),
}

function setup(options: { deployments?: Deployment[]; healthPath?: string | null; offline?: () => boolean } = {}) {
  const state = new Map<string, unknown>()
  const answers: ProbeAnswer[] = []
  const probe = vi.fn(async (_url: string) => answers.shift() ?? { status: 200, ms: 120, failure: null })
  const project = vi.fn(async (): Promise<ProjectDeployment> => ({
    recommended: null,
    binding: null,
    capabilities: [],
    productionUrl: 'https://shop.example',
    deployments: options.deployments ?? [live],
    error: options.offline?.() ? { kind: null, message: 'Vercel did not answer.' } : null,
  }))
  const openThread = vi.fn(async () => ({ taskId: 't-incident', sessionId: 's-incident' }))
  const notify = vi.fn()
  const send = vi.fn(async (_session: string | null, _text: string, commit?: () => void) => {
    commit?.()
    return true
  })
  const watches = new UptimeWatches(
    {
      getState: <T>(key: string, fallback: T) => (state.has(key) ? (state.get(key) as T) : fallback),
      setState: (key, value) => void state.set(key, value),
      projectIds: () => ['p1'],
      healthPath: () => options.healthPath ?? null,
      openThread,
      notify,
    },
    { send },
    {
      binding: () => ({
        platform: 'vercel',
        siteId: 'prj',
        siteName: 'shop',
        repository: 'me/shop',
        productionBranch: 'main',
        accountId: 'u1',
        scope: null,
      }),
      project,
      logs: async () => 'Build failed\nTypeError: x is undefined',
    },
    probe,
  )
  let now = Date.UTC(2026, 10, 7, 10)
  const step = (minutes = 5) => watches.tick((now += minutes * 60_000))
  return { watches, answers, probe, project, openThread, notify, send, step, state }
}

const down: ProbeAnswer = { status: 502, ms: 340, failure: null }

describe('uptime watch', () => {
  it('checks the health path on the production address once a production deployment is live', async () => {
    const { watches, probe, step } = setup({ healthPath: '/api/health' })
    await step()
    expect(probe).toHaveBeenCalledWith('https://shop.example/api/health')
    expect(watches.status('p1')).toMatchObject({
      enabled: true,
      url: 'https://shop.example/api/health',
      last: { result: 'up', status: 200 },
    })
    // Within five minutes nothing is checked again.
    await step(1)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('waits for the first production deployment, and never checks another origin', async () => {
    const { probe, step } = setup({ deployments: [{ ...live, state: 'building' }] })
    await step()
    expect(probe).not.toHaveBeenCalled()
    expect(checkedUrl('https://shop.example', '//evil.example/x')).toBe('https://shop.example/')
  })

  it('opens one incident thread after two failed checks, with the status, deployment and log, and notifies', async () => {
    const { answers, openThread, notify, step, watches } = setup()
    answers.push(down, down, down)
    await step()
    expect(openThread).not.toHaveBeenCalled()
    await step()
    expect(openThread).toHaveBeenCalledTimes(1)
    const [projectId, title, brief] = openThread.mock.calls[0] as unknown as [string, string, string]
    expect(projectId).toBe('p1')
    expect(title).toBe('Down: shop.example')
    expect(brief).toContain('HTTP 502 after 340 ms')
    expect(brief).toContain('dpl_2')
    expect(brief).toContain('TypeError: x is undefined')
    expect(brief).toContain('deploy_rollback')
    expect(notify).toHaveBeenCalledWith({ taskId: 't-incident', sessionId: 's-incident' })
    // A third failure does not open a second incident.
    await step()
    expect(openThread).toHaveBeenCalledTimes(1)
    expect(watches.status('p1').incident).toMatchObject({ taskId: 't-incident' })
  })

  it('closes the incident with a recap in the same thread when the address answers again', async () => {
    const { answers, send, step, watches } = setup()
    answers.push(down, down)
    await step()
    await step()
    await step()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toBe('s-incident')
    expect(send.mock.calls[0]?.[1]).toContain('answers again')
    expect(watches.status('p1')).toMatchObject({ incident: null, downSince: null, last: { result: 'up' } })
  })

  it('reports a sleep between checks as unknown, and does not count failures across it', async () => {
    const { answers, openThread, step, watches } = setup()
    answers.push(down, down)
    await step()
    await step(120)
    expect(openThread).not.toHaveBeenCalled()
    const gap = watches.status('p1').gap
    expect(gap && gap.to - gap.from).toBe(120 * 60_000)
  })

  it('counts a check as unknown when the platform cannot be reached either', async () => {
    const { answers, openThread, step, watches } = setup({ offline: () => true })
    answers.push({ status: null, ms: 10, failure: 'unreachable' }, { status: null, ms: 10, failure: 'unreachable' })
    await step()
    await step()
    expect(openThread).not.toHaveBeenCalled()
    expect(watches.status('p1').last?.result).toBe('unknown')
  })

  it('stops checking when turned off, and forgets an open incident', async () => {
    const { answers, probe, step, watches } = setup()
    answers.push(down, down)
    await step()
    await step()
    expect(watches.setEnabled('p1', false)).toMatchObject({ enabled: false, incident: null, last: null })
    const calls = probe.mock.calls.length
    await step(UPTIME_INTERVAL / 60_000)
    expect(probe).toHaveBeenCalledTimes(calls)
  })
})

describe('live probe', () => {
  it('follows redirects on the same host only, and counts one elsewhere as an answer', async () => {
    const seen: string[] = []
    const server = createServer((request, response) => {
      seen.push(request.url ?? '')
      const port = (server.address() as AddressInfo).port
      if (request.url === '/') response.writeHead(301, { Location: '/home' }).end()
      else if (request.url === '/home') response.writeHead(302, { Location: `http://localhost:${port}/away` }).end()
      else response.writeHead(200).end('ok')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const answer = await liveProbe(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`)
      expect(answer).toMatchObject({ status: 302, failure: null })
      expect(seen).toEqual(['/', '/home'])
    } finally {
      server.close()
    }
  })
})

it('watches an app published from this computer at its lasting address, and nothing while it has none', async () => {
  const probe = vi.fn(async (_url: string) => ({ status: 200, ms: 50, failure: null }))
  let address: string | null = null
  const watches = new UptimeWatches(
    {
      getState: () => ({}) as never,
      setState: () => {},
      projectIds: () => ['p1'],
      healthPath: () => '/health',
      openThread: vi.fn(),
      notify: vi.fn(),
      localAddress: () => address,
    },
    { send: vi.fn() },
    { binding: () => null, project: vi.fn(), logs: vi.fn() },
    probe,
  )
  await watches.tick(Date.UTC(2026, 10, 8, 10))
  expect(probe).not.toHaveBeenCalled()
  address = 'https://demo.example.com'
  await watches.tick(Date.UTC(2026, 10, 8, 11))
  expect(probe).toHaveBeenCalledWith('https://demo.example.com/health')
})
