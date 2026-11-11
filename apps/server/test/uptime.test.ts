import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { checkedUrl, liveProbe, UPTIME_INTERVAL, UptimeWatches, type ProbeAnswer } from '../src/workspace/deploy/uptime'

function setup(
  options: {
    healthPath?: string | null
    offline?: () => boolean
    address?: string | null
    productionAddress?: () => Promise<string | null>
  } = {},
) {
  const state = new Map<string, unknown>()
  const answers: ProbeAnswer[] = []
  const probe = vi.fn(async (_url: string) => answers.shift() ?? { status: 200, ms: 120, failure: null })
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
      online: async () => !options.offline?.(),
      ...(options.productionAddress ? { productionAddress: options.productionAddress } : {}),
    },
    { send },
    probe,
  )
  if (options.address !== null) watches.setAddress('p1', options.address ?? 'https://shop.example')
  let now = Date.UTC(2026, 10, 7, 10)
  const step = (minutes = 5) => watches.tick((now += minutes * 60_000))
  return { watches, answers, probe, openThread, notify, send, step, state }
}

const down: ProbeAnswer = { status: 502, ms: 340, failure: null }

describe('uptime watch', () => {
  it('watches the production address the Git host recorded until the person saves another', async () => {
    const found = vi.fn(async () => 'https://shop.vercel.app')
    const { watches, probe, step } = setup({ address: null, productionAddress: found })
    await step()
    expect(watches.status('p1')).toMatchObject({ address: 'https://shop.vercel.app', source: 'git-host' })
    expect(probe).toHaveBeenCalledWith('https://shop.vercel.app/')
    // The Git host is asked again only after a while, not on every check.
    await step()
    expect(found).toHaveBeenCalledTimes(1)
    watches.setAddress('p1', 'https://shop.example')
    expect(watches.status('p1')).toMatchObject({ address: 'https://shop.example', source: 'saved' })
  })

  it('checks the health path on the live address the person saved', async () => {
    const { watches, probe, step } = setup({ healthPath: '/api/health' })
    await step()
    expect(probe).toHaveBeenCalledWith('https://shop.example/api/health')
    expect(watches.status('p1')).toMatchObject({
      enabled: true,
      address: 'https://shop.example',
      url: 'https://shop.example/api/health',
      last: { result: 'up', status: 200 },
    })
    // Within five minutes nothing is checked again.
    await step(1)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('checks nothing until an address is saved, starts over at a new one, and never checks another origin', async () => {
    const { probe, step, watches, answers } = setup({ address: null })
    await step()
    expect(probe).not.toHaveBeenCalled()
    watches.setAddress('p1', 'https://old.example')
    answers.push(down)
    await step()
    expect(watches.setAddress('p1', 'https://new.example')).toMatchObject({
      address: 'https://new.example',
      last: null,
    })
    await step()
    expect(probe).toHaveBeenLastCalledWith('https://new.example/')
    expect(checkedUrl('https://shop.example', '//evil.example/x')).toBe('https://shop.example/')
  })

  it('opens one incident thread after two failed checks, pointing at the latest deploy, and notifies', async () => {
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
    expect(brief).toContain('platform_cli')
    expect(brief).toContain('roll back')
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

  it('counts a check as unknown when this host is offline', async () => {
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
      online: async () => true,
    },
    { send: vi.fn() },
    probe,
  )
  await watches.tick(Date.UTC(2026, 10, 8, 10))
  expect(probe).not.toHaveBeenCalled()
  address = 'https://demo.example.com'
  await watches.tick(Date.UTC(2026, 10, 8, 11))
  expect(probe).toHaveBeenCalledWith('https://demo.example.com/health')
})
