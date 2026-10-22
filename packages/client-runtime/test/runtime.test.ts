import { afterEach, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROTOCOL_HEADER, PROTOCOL_VERSION, decodeInvoke } from '@ramu/contracts'
import { runtimeInvoke, runtimeSocket, subscribeRuntime } from '../src'

const servers: Server[] = [],
  dirs: string[] = []
afterEach(() => {
  servers.forEach((server) => server.close())
  servers.length = 0
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  dirs.length = 0
})

async function listen(handler: Parameters<typeof createServer>[1], target: number | string) {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(target as never, resolve))
  return server
}
const echoFor =
  (token: string | null): Parameters<typeof createServer>[1] =>
  async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const { method, args, operationKey } = decodeInvoke(Buffer.concat(chunks).toString())
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify(
        method === 'fail'
          ? { error: 'nope' }
          : {
              value: {
                method,
                args: args.length,
                first: args[0] === undefined,
                operationKey,
                protocol: req.headers[PROTOCOL_HEADER],
              },
            },
      ),
    )
  }

it('derives a short, stable socket path per profile', () => {
  expect(runtimeSocket('/a')).toBe(runtimeSocket('/a'))
  expect(runtimeSocket('/a')).not.toBe(runtimeSocket('/b'))
  expect(runtimeSocket('/a'.repeat(200)).length).toBeLessThan(100)
})

it('invokes over a unix socket with the protocol header', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-rt-'))
  dirs.push(dir)
  const path = join(dir, 's.sock')
  await listen(echoFor(null), path)
  const value = await runtimeInvoke(path, 'x.y', [undefined, 1])
  expect(value).toMatchObject({ method: 'x.y', args: 2, first: true, protocol: String(PROTOCOL_VERSION) })
})

it('sends the operation key only when the caller gives one', async () => {
  const server = await listen(echoFor(null), 0)
  const target = { kind: 'http' as const, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token: '' }
  expect((await runtimeInvoke(target, 'x.y')).operationKey).toBeUndefined()
  expect((await runtimeInvoke(target, 'x.y', [], { operationKey: 'op-12345678' })).operationKey).toBe('op-12345678')
})

it('authenticates over HTTP and surfaces server errors', async () => {
  const server = await listen(echoFor('secret'), 0)
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  expect((await runtimeInvoke({ kind: 'http', url, token: 'secret' }, 'ok')).method).toBe('ok')
  await expect(runtimeInvoke({ kind: 'http', url, token: 'secret' }, 'fail')).rejects.toThrow('nope')
  await expect(runtimeInvoke({ kind: 'http', url, token: 'wrong' }, 'ok')).rejects.toThrow(/access token/)
})

it('streams events and reports connection state', async () => {
  const server = await listen((req, res) => {
    if (req.headers.authorization !== 'Bearer secret') {
      res.writeHead(401).end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(': connected\n\n')
    res.write(`data: ${JSON.stringify({ channel: 'automation:changed', payload: {} })}\n\n`)
  }, 0)
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const seen: string[] = []
  const stop = subscribeRuntime({ kind: 'http', url, token: 'secret' }, (channel) => seen.push(channel))
  await expect.poll(() => seen).toEqual(['background:connection', 'automation:changed'])
  stop()
})

it('flags a restart only when the host announces a different run after reconnecting', async () => {
  let connections = 0
  const server = await listen((_req, res) => {
    const epoch = connections++ < 2 ? 'run-a' : 'run-b'
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ channel: 'background:epoch', payload: { epoch } })}\n\n`)
    if (connections <= 2) setTimeout(() => res.end(), 50)
  }, 0)
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const seen: { channel: string; payload: { connected?: boolean; restarted?: boolean } }[] = []
  const stop = subscribeRuntime({ kind: 'http', url, token: '' }, (channel, payload) => seen.push({ channel, payload }))
  await expect.poll(() => seen.some((item) => item.payload.restarted), { timeout: 8000 }).toBe(true)
  // The epoch announcement itself is internal, and a reconnect to the same run is not a restart.
  expect(seen.every((item) => item.channel === 'background:connection')).toBe(true)
  expect(seen.filter((item) => item.payload.restarted)).toHaveLength(1)
  stop()
}, 12000)

it('stops retrying when the server rejects the token, so a revoked device is not locked out of pairing', async () => {
  let requests = 0
  const server = await listen((_req, res) => {
    requests++
    res.writeHead(401).end()
  }, 0)
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const seen: { connected: boolean; rejected?: boolean }[] = []
  const stop = subscribeRuntime({ kind: 'http', url, token: 'revoked' }, (_channel, payload) => seen.push(payload))
  await expect.poll(() => seen).toEqual([{ connected: false, rejected: true }])
  await new Promise((resolve) => setTimeout(resolve, 1500))
  expect(requests).toBe(1)
  stop()
})

it('retries a dropped network server with growing delays', async () => {
  let requests = 0
  const server = await listen((_req, res) => {
    requests++
    res.writeHead(503).end()
  }, 0)
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const stop = subscribeRuntime({ kind: 'http', url, token: 'x' }, () => {})
  await new Promise((resolve) => setTimeout(resolve, 3500))
  stop()
  // 1 s then 2 s: attempts at 0, 1 and 3 s. A fixed one-second retry would make four or five.
  expect(requests).toBeGreaterThanOrEqual(2)
  expect(requests).toBeLessThanOrEqual(3)
})

it('binds a private desktop identity only to its local event stream, never to a remote host', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-browser-stream-'))
  dirs.push(dir)
  const seen: (string | undefined)[] = []
  const handler: Parameters<typeof createServer>[1] = (req, res) => {
    seen.push(req.headers['x-ramu-desktop-client'] as string | undefined)
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(': connected\n\n')
  }
  const socket = runtimeSocket(dir)
  await listen(handler, socket)
  const remote = await listen(handler, 0)
  const localStop = subscribeRuntime(socket, () => {}, undefined, { localClientId: 'desktop-1' })
  await expect.poll(() => seen.length).toBe(1)
  const remoteStop = subscribeRuntime(
    { kind: 'http', url: `http://127.0.0.1:${(remote.address() as AddressInfo).port}`, token: 'secret' },
    () => {},
    undefined,
    { localClientId: 'desktop-1' },
  )
  try {
    await expect.poll(() => seen.length).toBe(2)
    expect(seen).toEqual(['desktop-1', undefined])
  } finally {
    localStop()
    remoteStop()
  }
})
