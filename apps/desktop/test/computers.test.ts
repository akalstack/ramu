import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RuntimeEndpoint } from '@ramu/contracts'
import { ComputerRegistry, LOCAL, type ComputerDeps } from '../src/main/computers'
import { RemoteServers } from '../src/main/remoteServers'

const dirs: string[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  dirs.length = 0
})

const urlOf = (target: string | RuntimeEndpoint) =>
  typeof target === 'string' ? target : target.kind === 'http' ? target.url : target.path

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'ramu hosts '))
  dirs.push(dir)
  const servers = new RemoteServers(join(dir, 'remote-servers.json'), {
    available: false,
    seal: (t) => t,
    open: (t) => t,
  })
  const streams = new Map<string, (channel: string, payload: any) => void>(),
    stops: string[] = [],
    delivered: [string, string][] = []
  const counts = new Map<string, { running: number; needsInput: number }>()
  const ssh = { ensure: vi.fn(async () => {}), connect: vi.fn(), close: vi.fn(), closeAll: vi.fn() }
  const deps: ComputerDeps = {
    servers,
    deviceName: 'My Mac',
    localName: () => 'This host',
    local: '/tmp/local.sock',
    subscribe: (target: RuntimeEndpoint, receive) => {
      streams.set(urlOf(target), receive)
      return () => {
        stops.push(urlOf(target))
        streams.delete(urlOf(target))
      }
    },
    invoke: vi.fn(async (target: string | RuntimeEndpoint, method: string) => {
      if (method === 'agent.counts') return counts.get(urlOf(target)) ?? { running: 0, needsInput: 0 }
      return { running: true }
    }),
    pair: vi.fn(async () => ({ token: 'tok' })),
    ssh,
    deliver: (id, channel) => delivered.push([id, channel]),
    changed: vi.fn(),
  }
  return { servers, streams, stops, delivered, counts, deps, ssh, registry: new ComputerRegistry(deps) }
}

it('lists this host first and connects every saved host at once', () => {
  const { servers, streams, registry } = setup()
  const a = servers.add('10.0.0.2:7788', 'Studio', 'a'),
    b = servers.add('10.0.0.3:7788', 'Server', 'b')
  registry.start()
  expect([...streams.keys()].sort()).toEqual(['http://10.0.0.2:7788', 'http://10.0.0.3:7788'])
  const list = registry.list(LOCAL)
  expect(list.computers.map((c) => c.name)).toEqual(['This host', 'Studio', 'Server'])
  expect(list.computers.slice(1).map((c) => c.status)).toEqual(['connecting', 'connecting'])
  expect(list.current).toBe(LOCAL)
  expect(JSON.stringify(list)).not.toContain('"token"')
  expect([a.id, b.id]).toEqual(list.computers.slice(1).map((c) => c.id))
})

it('tracks each host’s connection independently, including a rejected token', () => {
  const { servers, streams, registry, deps } = setup()
  const a = servers.add('10.0.0.2:7788', 'Studio', 'a'),
    b = servers.add('10.0.0.3:7788', 'Server', 'b')
  registry.start()
  streams.get('http://10.0.0.2:7788')!('background:connection', { connected: true })
  streams.get('http://10.0.0.3:7788')!('background:connection', { connected: false, rejected: true })
  const status = (id: string) => registry.list(LOCAL).computers.find((c) => c.id === id)!.status
  expect([status(a.id), status(b.id)]).toEqual(['connected', 'rejected'])
  streams.get('http://10.0.0.2:7788')!('background:connection', { connected: false })
  expect(status(a.id)).toBe('offline')
  expect(deps.changed).toHaveBeenCalled()
})

it('retrying an offline host keeps the other host connected and delivering events', () => {
  const { servers, streams, stops, delivered, registry } = setup()
  const a = servers.add('10.0.0.2:7788', 'Studio', 'a'),
    b = servers.add('10.0.0.3:7788', 'Server', 'b')
  registry.start()
  streams.get('http://10.0.0.2:7788')!('background:connection', { connected: false, waiting: 'network' })
  const other = streams.get('http://10.0.0.3:7788')!
  other('background:connection', { connected: true })
  registry.retry(a.id)
  expect(stops).toEqual(['http://10.0.0.2:7788'])
  expect(streams.get('http://10.0.0.3:7788')).toBe(other)
  expect(registry.status(b.id)).toBe('connected')
  other('fs:changed', {})
  expect(delivered.at(-1)).toEqual([b.id, 'fs:changed'])
})

it('counts working and waiting threads per host when their state changes', async () => {
  const { servers, streams, counts, registry } = setup()
  const a = servers.add('10.0.0.2:7788', 'Studio', 'a')
  registry.start()
  counts.set('http://10.0.0.2:7788', { running: 2, needsInput: 1 })
  streams.get('http://10.0.0.2:7788')!('agent:event', { sessionId: 's', event: { kind: 'state', state: 'running' } })
  streams.get('http://10.0.0.2:7788')!('agent:event', {
    sessionId: 's',
    event: { kind: 'state', state: 'needs-input' },
  })
  await vi.advanceTimersByTimeAsync(1000)
  expect(registry.list(LOCAL).computers.find((c) => c.id === a.id)).toMatchObject({ running: 2, needsInput: 1 })
  counts.set('/tmp/local.sock', { running: 1, needsInput: 0 })
  registry.observe(LOCAL, 'agent:event', { event: { kind: 'state', state: 'running' } })
  await vi.advanceTimersByTimeAsync(1000)
  expect(registry.list(a.id).computers[0]).toMatchObject({ id: LOCAL, running: 1 })
  expect(registry.list(a.id).current).toBe(a.id)
})

it('delivers each host’s events to that host only', () => {
  const { servers, streams, delivered, registry } = setup()
  const a = servers.add('10.0.0.2:7788', 'Studio', 'a')
  registry.start()
  streams.get('http://10.0.0.2:7788')!('fs:changed', {})
  expect(delivered).toEqual([[a.id, 'fs:changed']])
})

it('pairs, proves the token works, connects, and replaces a host paired again', async () => {
  const { servers, streams, stops, deps, registry } = setup()
  const first = await registry.pair('10.0.0.2:7788', ' ABCDE-FGHJK ', 'Studio')
  expect(deps.pair).toHaveBeenCalledWith('http://10.0.0.2:7788', 'ABCDE-FGHJK', 'My Mac')
  expect(first.name).toBe('Studio')
  expect(streams.has('http://10.0.0.2:7788')).toBe(true)
  const again = await registry.pair('http://10.0.0.2:7788', 'ZZZZZ-ZZZZZ', 'Studio 2')
  expect(again.id).not.toBe(first.id)
  expect(servers.list()).toHaveLength(1)
  expect(stops).toEqual(['http://10.0.0.2:7788'])
  expect(streams.has('http://10.0.0.2:7788')).toBe(true)
})

it('does not save a host whose token fails the check', async () => {
  const { servers, deps, registry } = setup()
  vi.mocked(deps.invoke).mockRejectedValueOnce(new Error('The server rejected the access token'))
  await expect(registry.pair('10.0.0.2:7788', 'ABCDE-FGHJK', 'Studio')).rejects.toThrow(/rejected/)
  expect(servers.list()).toEqual([])
})

it('forgets a host and stops its connection, but never this host', () => {
  const { servers, stops, registry } = setup()
  const a = servers.add('10.0.0.2:7788', 'Studio', 'a')
  registry.start()
  registry.forget(a.id)
  expect(stops).toEqual(['http://10.0.0.2:7788'])
  expect(registry.list(LOCAL).computers).toHaveLength(1)
  expect(() => registry.forget(LOCAL)).toThrow()
  expect(registry.exists(a.id)).toBe(false)
  expect(() => registry.endpoint(a.id)).toThrow(/no longer saved/)
})

it('pauses one host persistently and resumes without disturbing another connection', () => {
  const { servers, streams, stops, deps, registry } = setup()
  const a = servers.add('10.0.0.2:7788', 'Studio', 'a'),
    b = servers.add('10.0.0.3:7788', 'Server', 'b')
  registry.start()
  const other = streams.get(b.url)
  registry.update(a.id, { enabled: false, name: 'Workstation' })
  expect(registry.status(a.id)).toBe('paused')
  expect(streams.has(a.url)).toBe(false)
  expect(stops).toEqual([a.url])
  expect(streams.get(b.url)).toBe(other)
  registry.update(a.id, { enabled: true })
  expect(streams.has(a.url)).toBe(true)
  expect(streams.get(b.url)).toBe(other)
  const subscribe = vi.spyOn(deps, 'subscribe')
  registry.update(a.id, { name: 'Studio again' })
  expect(subscribe).not.toHaveBeenCalled()
})

it('does not connect a saved paused host at startup', () => {
  const { servers, streams, registry } = setup()
  const saved = servers.add('10.0.0.2:7788', 'Studio', 'a')
  servers.update(saved.id, { enabled: false })
  registry.start()
  expect(streams.size).toBe(0)
  expect(registry.list(LOCAL).computers[1]).toMatchObject({ status: 'paused', enabled: false, retryMode: 'events' })
})

it('cancels a pending activity refresh when a host is forgotten', async () => {
  const { servers, streams, deps, registry } = setup()
  const saved = servers.add('10.0.0.2:7788', 'Studio', 'a')
  registry.start()
  streams.get('http://10.0.0.2:7788')!('background:connection', { connected: true })
  registry.forget(saved.id)
  await vi.advanceTimersByTimeAsync(1000)
  expect(deps.invoke).not.toHaveBeenCalled()
})

it('ignores activity replies from a connection that has gone offline', async () => {
  const { servers, streams, deps, registry } = setup()
  const saved = servers.add('10.0.0.2:7788', 'Studio', 'a')
  let reply!: (counts: { running: number; needsInput: number }) => void
  vi.mocked(deps.invoke).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        reply = resolve
      }),
  )
  registry.start()
  const receive = streams.get('http://10.0.0.2:7788')!
  receive('background:connection', { connected: true })
  await vi.advanceTimersByTimeAsync(1000)
  receive('background:connection', { connected: false })
  reply({ running: 2, needsInput: 1 })
  await Promise.resolve()
  expect(registry.list(LOCAL).computers.find((c) => c.id === saved.id)).toMatchObject({
    status: 'offline',
    running: 0,
    needsInput: 0,
  })
})

it('keeps only one activity request in flight and coalesces further changes', async () => {
  const { servers, streams, deps, registry } = setup()
  const saved = servers.add('10.0.0.2:7788', 'Studio', 'a')
  let reply!: (counts: { running: number; needsInput: number }) => void
  vi.mocked(deps.invoke).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        reply = resolve
      }),
  )
  registry.start()
  const receive = streams.get(saved.url)!
  receive('background:connection', { connected: true })
  await vi.advanceTimersByTimeAsync(1000)
  for (let i = 0; i < 100; i++) {
    receive('agent:event', { event: { kind: 'state' } })
    await vi.advanceTimersByTimeAsync(20)
  }
  expect(deps.invoke).toHaveBeenCalledTimes(1)
  reply({ running: 1, needsInput: 0 })
  await vi.advanceTimersByTimeAsync(1000)
  expect(deps.invoke).toHaveBeenCalledTimes(2)
  registry.stop()
})

it('reciprocal A↔B connections stay direct and never echo events or counts back to their origin', async () => {
  const a = setup(),
    b = setup()
  const remoteB = a.servers.add('10.0.0.2:7788', 'B', 'a-on-b')
  const remoteA = b.servers.add('10.0.0.1:7788', 'A', 'b-on-a')
  a.counts.set(remoteB.url, { running: 2, needsInput: 1 })
  b.counts.set(remoteA.url, { running: 3, needsInput: 0 })
  a.registry.start()
  b.registry.start()
  a.streams.get(remoteB.url)!('background:connection', { connected: true })
  b.streams.get(remoteA.url)!('background:connection', { connected: true })
  a.streams.get(remoteB.url)!('agent:event', { sessionId: 'b-task', event: { kind: 'state', state: 'running' } })
  b.streams.get(remoteA.url)!('agent:event', { sessionId: 'a-task', event: { kind: 'state', state: 'running' } })
  await vi.advanceTimersByTimeAsync(3000)
  expect(a.registry.list(LOCAL).computers).toHaveLength(2)
  expect(b.registry.list(LOCAL).computers).toHaveLength(2)
  expect(a.delivered.filter(([, channel]) => channel === 'agent:event')).toEqual([[remoteB.id, 'agent:event']])
  expect(b.delivered.filter(([, channel]) => channel === 'agent:event')).toEqual([[remoteA.id, 'agent:event']])
  expect(a.deps.invoke).toHaveBeenCalledTimes(1)
  expect(b.deps.invoke).toHaveBeenCalledTimes(1)
  expect(a.deps.invoke).toHaveBeenCalledWith(
    expect.objectContaining({ url: remoteB.url, token: 'a-on-b' }),
    'agent.counts',
    [],
    expect.any(Object),
  )
  expect(a.registry.list(LOCAL).computers[1]).toMatchObject({ running: 2, needsInput: 1 })
  expect(b.registry.list(LOCAL).computers[1]).toMatchObject({ running: 3, needsInput: 0 })
  a.registry.forget(remoteB.id)
  expect(b.registry.status(remoteA.id)).toBe('connected')
  a.registry.stop()
  b.registry.stop()
})

it('brings up the tunnel before subscribing to an SSH host, and tears it down when forgotten', async () => {
  const { servers, streams, registry, ssh } = setup()
  const saved = servers.add('http://127.0.0.1:49200', 'Build box', 'tok', 1, {
    target: 'build',
    remote: '127.0.0.1:7788',
  })
  registry.start()
  expect(ssh.ensure).toHaveBeenCalledWith(
    saved.id,
    expect.objectContaining({ ssh: { target: 'build', remote: '127.0.0.1:7788' } }),
  )
  expect(streams.size).toBe(0)
  await vi.advanceTimersByTimeAsync(0)
  expect([...streams.keys()]).toEqual(['http://127.0.0.1:49200'])
  expect(registry.list(LOCAL).computers[1]).toMatchObject({ ssh: 'build', url: 'http://127.0.0.1:49200' })
  registry.forget(saved.id)
  expect(ssh.close).toHaveBeenCalledWith(saved.id)
})

it('shows an SSH host as offline and retries when its tunnel cannot open', async () => {
  const { servers, streams, registry, ssh } = setup()
  ssh.ensure.mockRejectedValueOnce(new Error('build is not a trusted host yet'))
  const saved = servers.add('http://127.0.0.1:49200', 'Build box', 'tok', 1, {
    target: 'build',
    remote: '127.0.0.1:7788',
  })
  registry.start()
  await vi.advanceTimersByTimeAsync(0)
  expect(registry.status(saved.id)).toBe('offline')
  expect(streams.size).toBe(0)
  await vi.advanceTimersByTimeAsync(20_000)
  expect(ssh.ensure).toHaveBeenCalledTimes(2)
  expect([...streams.keys()]).toEqual(['http://127.0.0.1:49200'])
})

it('defaults browsing to all hosts and shares the filter without changing workspace ownership', () => {
  const { registry, servers } = setup()
  const remote = servers.add('10.0.0.9:7788', 'Studio', 'token')
  expect(registry.list(LOCAL).scope).toBeNull()
  expect(registry.list(remote.id).scope).toBeNull()
  registry.setScope(remote.id)
  expect(registry.list(LOCAL)).toMatchObject({ current: LOCAL, scope: remote.id })
  expect(registry.list(remote.id)).toMatchObject({ current: remote.id, scope: remote.id })
  registry.setScope(null)
  expect(registry.list(remote.id)).toMatchObject({ current: remote.id, scope: null })
  expect(() => registry.setScope('missing')).toThrow('no longer saved')
  registry.setScope(remote.id)
  registry.forget(remote.id)
  expect(registry.list(LOCAL).scope).toBeNull()
})
