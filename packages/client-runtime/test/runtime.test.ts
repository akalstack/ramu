import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeHostSockets, runtimeInvoke, runtimeSocket, subscribeRuntime } from '../src'
import { socketHost } from './support/socketHost'

const dirs: string[] = [],
  hosts: Awaited<ReturnType<typeof socketHost>>[] = []
afterEach(async () => {
  closeHostSockets()
  for (const host of hosts.splice(0)) await host.close()
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  dirs.length = 0
})

it('derives a short, stable socket path per profile', () => {
  expect(runtimeSocket('/a')).toBe(runtimeSocket('/a'))
  expect(runtimeSocket('/a')).not.toBe(runtimeSocket('/b'))
  expect(runtimeSocket('/a'.repeat(200)).length).toBeLessThan(100)
})

it('invokes over the service socket on this machine', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-rt-'))
  dirs.push(dir)
  const path = join(dir, 's.sock')
  const running = await socketHost({ unix: path, answer: (call) => ({ method: call.method, args: call.args.length }) })
  hosts.push(running)
  expect(await runtimeInvoke(path, 'x.y', [undefined, 1])).toEqual({ method: 'x.y', args: 2 })
})

it('fails at once with the connection error when nothing listens, so the app can start its service', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-rt-'))
  dirs.push(dir)
  const started = Date.now()
  await expect(runtimeInvoke(join(dir, 'missing.sock'), 'background.status')).rejects.toMatchObject({ code: 'ENOENT' })
  expect(Date.now() - started).toBeLessThan(2000)
})

const host = async (options?: Parameters<typeof socketHost>[0]) => {
  const running = await socketHost(options)
  hosts.push(running)
  return running
}

it('sends the operation key only when the caller gives one', async () => {
  const running = await host({ answer: (call) => call })
  expect((await runtimeInvoke(running.endpoint, 'x.y')).operationKey).toBeUndefined()
  expect((await runtimeInvoke(running.endpoint, 'x.y', [], { operationKey: 'op-12345678' })).operationKey).toBe(
    'op-12345678',
  )
})

it('carries every call over one socket and surfaces host errors', async () => {
  const running = await host({
    answer: (call) => {
      if (call.method === 'fail') throw new Error('nope')
      return { method: call.method }
    },
  })
  expect((await runtimeInvoke(running.endpoint, 'ok')).method).toBe('ok')
  await expect(runtimeInvoke(running.endpoint, 'fail')).rejects.toThrow('nope')
  await runtimeInvoke(running.endpoint, 'ok')
  expect(running.connections).toHaveLength(1)
})

it('reports a refused token, and a host with no socket, instead of falling back to another transport', async () => {
  const running = await host()
  await expect(runtimeInvoke({ ...running.endpoint, token: 'wrong' }, 'ok')).rejects.toThrow(/access token/)
  const old = await host({ refuse: 404 })
  await expect(runtimeInvoke(old.endpoint, 'ok')).rejects.toThrow(/Cannot connect to this host/)
})

it('streams events and reports connection state', async () => {
  const running = await host()
  const seen: string[] = []
  const stop = subscribeRuntime(running.endpoint, (channel) => seen.push(channel))
  await expect.poll(() => seen).toEqual(['background:connection'])
  running.push('automation:changed')
  await expect.poll(() => seen).toEqual(['background:connection', 'automation:changed'])
  stop()
})

it('flags a restart only when the host announces a different run after reconnecting', async () => {
  let connections = 0
  const running = await host({ epoch: () => (connections++ < 2 ? 'run-a' : 'run-b') })
  const seen: { channel: string; payload: { connected?: boolean; restarted?: boolean } }[] = []
  const stop = subscribeRuntime(running.endpoint, (channel, payload) => seen.push({ channel, payload }))
  await expect.poll(() => running.open()).toBe(1)
  running.drop()
  // The same run again is a reconnect, not a restart.
  await expect.poll(() => connections, { timeout: 6000 }).toBe(2)
  await expect.poll(() => running.open(), { timeout: 6000 }).toBe(1)
  expect(seen.some((item) => item.payload.restarted)).toBe(false)
  running.drop()
  await expect.poll(() => seen.some((item) => item.payload.restarted), { timeout: 8000 }).toBe(true)
  expect(seen.every((item) => item.channel === 'background:connection')).toBe(true)
  expect(seen.filter((item) => item.payload.restarted)).toHaveLength(1)
  stop()
}, 25000)

it('stops retrying when the server rejects the token, so a revoked device is not locked out of pairing', async () => {
  const running = await host()
  const seen: { connected: boolean; rejected?: boolean }[] = []
  const stop = subscribeRuntime({ ...running.endpoint, token: 'revoked' }, (_channel, payload) => seen.push(payload))
  await expect.poll(() => seen).toEqual([{ connected: false, rejected: true }])
  await new Promise((resolve) => setTimeout(resolve, 1500))
  expect(running.upgrades).toHaveLength(1)
  stop()
})

it('retries a refusing host with growing delays', async () => {
  const running = await host({ refuse: 503 })
  const stop = subscribeRuntime(running.endpoint, () => {})
  await new Promise((resolve) => setTimeout(resolve, 3500))
  stop()
  // Delays of 0.5-1 s then 1-2 s: attempts near 0, 0.75 and 2.25 s. A fixed one-second retry would make four or five.
  expect(running.upgrades.length).toBeGreaterThanOrEqual(2)
  expect(running.upgrades.length).toBeLessThanOrEqual(4)
})

it('binds a private desktop identity only to its local socket, never to a remote host', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-browser-stream-'))
  dirs.push(dir)
  const local = await socketHost({ unix: runtimeSocket(dir) })
  hosts.push(local)
  const remote = await host()
  const localStop = subscribeRuntime(runtimeSocket(dir), () => {}, undefined, { localClientId: 'desktop-1' })
  await expect.poll(() => local.upgrades.length).toBe(1)
  const remoteStop = subscribeRuntime(remote.endpoint, () => {}, undefined, {
    localClientId: 'desktop-1',
    presencePort: 4321,
  })
  try {
    await expect.poll(() => remote.upgrades.length).toBe(1)
    expect(local.upgrades[0]!['x-ramu-desktop-client']).toBe('desktop-1')
    expect(remote.upgrades[0]!['x-ramu-desktop-client']).toBeUndefined()
    expect(remote.upgrades[0]!['x-ramu-presence-port']).toBe('4321')
  } finally {
    localStop()
    remoteStop()
  }
})
