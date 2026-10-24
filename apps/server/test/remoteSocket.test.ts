import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it } from 'vitest'
import WebSocket from 'ws'
import { nodeSocketFactory, RuntimeSocket, runtimeInvoke, setSocketTransport } from '@ramu/client-runtime'
import { decodeSocketFrame, encodeSocketFrame, SOCKET_PATH, type SocketServerFrame } from '@ramu/contracts'
import { serveSockets, type EventSink, type SocketHost } from '../src/remote/socket'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})

const DEVICE = { id: 'device-1', name: 'Phone', role: 'owner' } as never

async function start(overrides: Partial<SocketHost> = {}, options = {}) {
  const sinks = new Set<EventSink>()
  const invoked: { method: string; args: unknown[]; operationKey?: string }[] = []
  const host: SocketHost = {
    accept: async (req, res) => {
      if (req.headers.authorization !== 'Bearer good') {
        res.writeHead(401).end()
        return undefined
      }
      return DEVICE
    },
    invoke: async (_device, request) => {
      invoked.push(request)
      if (request.method === 'fail') return { ok: false, status: 400, error: 'nope' }
      if (request.method === 'viewer') return { ok: false, status: 403, error: 'viewer' }
      if (request.method === 'slow') await new Promise((resolve) => setTimeout(resolve, 200))
      return { ok: true, value: request.method === 'echo' ? request.args : undefined }
    },
    epoch: 'epoch-1',
    attach: (sink) => sinks.add(sink),
    detach: (sink) => sinks.delete(sink),
    ...overrides,
  }
  const server: Server = createServer((_req, res) => res.writeHead(404).end())
  const sockets = serveSockets(server, host, { heartbeatMs: 50, ...options })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => {
    sockets.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const port = (server.address() as AddressInfo).port
  const connect = (path = SOCKET_PATH, token = 'good') => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { authorization: `Bearer ${token}` } })
    ws.on('error', () => {})
    cleanup.push(() => ws.terminate())
    const frames: SocketServerFrame[] = []
    ws.on('message', (data) => {
      const frame = decodeSocketFrame(data.toString(), 'server')
      if (frame) frames.push(frame)
    })
    const until = async (check: () => boolean) => {
      for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10))
      expect(check()).toBe(true)
    }
    return { ws, frames, until }
  }
  return { connect, sinks, invoked, sockets, port }
}

it('refuses an unauthenticated upgrade before any socket exists', async () => {
  const { connect, sockets } = await start()
  const { ws } = connect(SOCKET_PATH, 'bad')
  const status = await new Promise<number>((resolve) =>
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode!)),
  )
  expect(status).toBe(401)
  expect(sockets.connections()).toBe(0)
})

it('only upgrades the socket path', async () => {
  const { connect } = await start()
  const { ws } = connect('/events')
  await new Promise<void>((resolve) => ws.on('error', () => resolve()))
})

it('announces the server run, answers calls by id and keeps optional arguments in position', async () => {
  const { connect, invoked } = await start()
  const { ws, frames, until } = connect()
  await until(() => frames.length === 1)
  expect(frames[0]).toEqual({ t: 'ready', epoch: 'epoch-1' })
  ws.send(
    encodeSocketFrame({ t: 'invoke', id: 7, method: 'echo', args: [undefined, 'x'], operationKey: 'operation-key-1' }),
  )
  ws.send(encodeSocketFrame({ t: 'invoke', id: 8, method: 'fail', args: [] }))
  ws.send(encodeSocketFrame({ t: 'invoke', id: 9, method: 'viewer', args: [] }))
  await until(() => frames.length === 4)
  expect(frames).toContainEqual({ t: 'result', id: 7, value: [undefined, 'x'] })
  expect(frames).toContainEqual({ t: 'error', id: 8, error: 'nope', status: 400 })
  expect(frames).toContainEqual({ t: 'error', id: 9, error: 'viewer', status: 403 })
  expect(invoked[0]).toMatchObject({ method: 'echo', operationKey: 'operation-key-1' })
})

it('delivers broadcast events as frames and stops after the socket closes', async () => {
  const { connect, sinks } = await start()
  const { ws, frames, until } = connect()
  await until(() => sinks.size === 1)
  const [sink] = [...sinks]
  sink!.write(': ping\n\n')
  sink!.write(`data: ${JSON.stringify({ channel: 'automation:changed', payload: { a: 1 } })}\n\n`)
  await until(() => frames.some((frame) => frame.t === 'event'))
  expect(frames.filter((frame) => frame.t === 'event')).toEqual([
    { t: 'event', channel: 'automation:changed', payload: { a: 1 } },
  ])
  ws.close()
  await until(() => sinks.size === 0)
})

it('answers pings, closes on a malformed frame and bounds calls in flight', async () => {
  const { connect } = await start({}, { maxInFlight: 2 })
  const ping = connect()
  await ping.until(() => ping.frames.length === 1)
  ping.ws.send(encodeSocketFrame({ t: 'ping' }))
  await ping.until(() => ping.frames.some((frame) => frame.t === 'pong'))

  const busy = connect()
  await busy.until(() => busy.frames.length === 1)
  for (const id of [1, 2, 3]) busy.ws.send(encodeSocketFrame({ t: 'invoke', id, method: 'slow', args: [] }))
  await busy.until(() => busy.frames.some((frame) => frame.t === 'error'))
  expect(busy.frames).toContainEqual({
    t: 'error',
    id: 3,
    error: 'Too many calls are running on this connection.',
    status: 429,
  })
  await busy.until(() => busy.frames.filter((frame) => frame.t === 'result').length === 2)

  const bad = connect()
  await bad.until(() => bad.frames.length === 1)
  const closed = new Promise<number>((resolve) => bad.ws.on('close', (code) => resolve(code)))
  bad.ws.send('{"t":"invoke","id":"nope"}')
  expect(await closed).toBe(1008)
})

it('works end to end with the client runtime over a real socket, and learns a refused token', async () => {
  const { port, sinks } = await start()
  const events: unknown[] = []
  const good = new RuntimeSocket({
    url: `http://127.0.0.1:${port}`,
    token: 'good',
    factory: nodeSocketFactory,
    onEvent: (channel, payload) => events.push([channel, payload]),
  })
  cleanup.push(() => good.close())
  good.start()
  for (let i = 0; i < 200 && good.state !== 'ready'; i++) await new Promise((resolve) => setTimeout(resolve, 10))
  expect(good.state).toBe('ready')
  await expect(good.invoke('echo', [1, undefined, 'x'])).resolves.toEqual([1, undefined, 'x'])
  await expect(good.invoke('fail', [])).rejects.toMatchObject({ message: 'nope', status: 400 })
  ;[...sinks][0]!.write(`data: ${JSON.stringify({ channel: 'automation:changed', payload: {} })}\n\n`)
  for (let i = 0; i < 200 && !events.length; i++) await new Promise((resolve) => setTimeout(resolve, 10))
  expect(events).toEqual([['automation:changed', {}]])

  const bad = new RuntimeSocket({
    url: `http://127.0.0.1:${port}`,
    token: 'wrong',
    factory: nodeSocketFactory,
    onEvent: () => {},
  })
  cleanup.push(() => bad.close())
  bad.start()
  for (let i = 0; i < 200 && bad.state === 'connecting'; i++) await new Promise((resolve) => setTimeout(resolve, 10))
  expect(bad.state).toBe('rejected')
})

it('sends runtime calls over the socket only when opted in and ready, and asks for calls only', async () => {
  const { port, sinks, invoked } = await start()
  const endpoint = { kind: 'http' as const, url: `http://127.0.0.1:${port}`, token: 'good' }
  cleanup.push(() => setSocketTransport(false))
  // Off by default: the call goes to HTTP, which this server does not serve, and no socket is opened.
  await expect(runtimeInvoke(endpoint, 'echo', [1])).rejects.toBeTruthy()
  expect(invoked).toHaveLength(0)
  setSocketTransport(true)
  // The first call finds the socket still connecting and falls back to HTTP without sending anything on it.
  await runtimeInvoke(endpoint, 'echo', [1]).catch(() => {})
  for (let i = 0; i < 200 && invoked.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    await runtimeInvoke(endpoint, 'echo', [2], { operationKey: 'operation-key-9' }).catch(() => {})
  }
  expect(invoked.at(-1)).toMatchObject({ method: 'echo', args: [2], operationKey: 'operation-key-9' })
  expect(sinks.size).toBe(0)
})

const push = (sinks: Set<EventSink>, channel: string, payload: unknown) => {
  for (const sink of sinks) sink.write(`data: ${JSON.stringify({ channel, payload })}\n\n`)
}
const events = (frames: SocketServerFrame[]) =>
  frames.filter((f) => f.t === 'event').map((f) => `${(f as any).channel}:${JSON.stringify((f as any).payload)}`)

it('delivers every event until the client subscribes, then only what it asked for', async () => {
  const { connect, sinks } = await start()
  const { ws, frames, until } = connect()
  await until(() => sinks.size === 1)
  push(sinks, 'workspace:changed', {})
  await until(() => events(frames).length === 1)
  ws.send(
    encodeSocketFrame({
      t: 'subscribe',
      id: 1,
      channels: ['agent:event', 'term:data'],
      keys: { 'agent:event': ['s1'], 'term:data': ['t1'] },
    }),
  )
  await until(() => frames.some((f) => f.t === 'result' && f.id === 1))
  push(sinks, 'workspace:changed', {})
  push(sinks, 'agent:event', { sessionId: 's2', event: {} })
  push(sinks, 'term:data', { id: 't2', data: 'x' })
  push(sinks, 'agent:event', { sessionId: 's1', event: {} })
  push(sinks, 'term:data', { id: 't1', data: 'y' })
  await until(() => events(frames).length === 3)
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(events(frames).slice(1)).toEqual([
    'agent:event:{"sessionId":"s1","event":{}}',
    'term:data:{"id":"t1","data":"y"}',
  ])
  // A listed channel without ids delivers every resource.
  ws.send(encodeSocketFrame({ t: 'subscribe', id: 2, channels: ['term:data'] }))
  await until(() => frames.some((f) => f.t === 'result' && f.id === 2))
  push(sinks, 'term:data', { id: 't9', data: 'z' })
  await until(() => events(frames).length === 3)
})

it('refuses a malformed subscription and a subscription on a calls-only connection', async () => {
  const { connect, sinks } = await start()
  const calls = connect(`${SOCKET_PATH}?events=none`)
  await calls.until(() => calls.frames.some((f) => f.t === 'ready'))
  calls.ws.send(encodeSocketFrame({ t: 'subscribe', id: 1, channels: ['agent:event'] }))
  await calls.until(() => calls.frames.some((f) => f.t === 'error' && f.id === 1))
  expect(sinks.size).toBe(0)
  const bad = connect()
  await bad.until(() => bad.frames.some((f) => f.t === 'ready'))
  bad.ws.send('{"t":"subscribe","id":1,"channels":[1]}')
  await new Promise<void>((resolve) => bad.ws.on('close', () => resolve()))
})

it('filters keyed channels by id without needing the id on unkeyed ones, and drops unlisted channels', async () => {
  const { connect, sinks } = await start()
  const { ws, frames, until } = connect()
  await until(() => sinks.size === 1)
  ws.send(
    encodeSocketFrame({
      t: 'subscribe',
      id: 1,
      channels: ['agent:event', 'usage:changed'],
      keys: { 'agent:event': ['s1'] },
    }),
  )
  await until(() => frames.some((f) => f.t === 'result' && f.id === 1))
  push(sinks, 'usage:changed', [])
  push(sinks, 'workspace:changed', {})
  push(sinks, 'agent:event', { event: {}, sessionId: 's1' })
  push(sinks, 'agent:event', { sessionId: 's2', event: { sessionId: 's1' } })
  await until(() => events(frames).length === 2)
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(events(frames).map((e) => e.split(':')[0] + ':' + e.split(':')[1])).toEqual(['usage:changed', 'agent:event'])
})
