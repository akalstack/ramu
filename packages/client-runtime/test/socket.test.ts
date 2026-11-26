import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { decodeSocketFrame, encodeSocketFrame, type SocketServerFrame } from '@ramu/contracts'
import { isTransportFailure } from '../src'
import { RuntimeSocket, type SocketFactory, type SocketHandlers, type SocketState } from '../src/socket'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

/** A scripted platform socket: the test plays the host. */
function fake() {
  const opened: {
    url: string
    headers: Record<string, string>
    handlers: SocketHandlers
    sent: string[]
    closed: boolean
  }[] = []
  const factory: SocketFactory = (url, headers, handlers) => {
    const entry = { url, headers, handlers, sent: [] as string[], closed: false }
    opened.push(entry)
    return {
      send: (text) => entry.sent.push(text),
      close: () => {
        entry.closed = true
        handlers.onclose({})
      },
    }
  }
  const host = (index: number, frame: SocketServerFrame) => opened[index]!.handlers.onmessage(encodeSocketFrame(frame))
  const calls = (index: number) =>
    opened[index]!.sent.map((text) => decodeSocketFrame(text, 'client')).filter((frame) => frame?.t === 'invoke') as {
      id: number
      method: string
      args: unknown[]
      operationKey?: string
    }[]
  return { opened, factory, host, calls }
}

function make(extra: Partial<ConstructorParameters<typeof RuntimeSocket>[0]> = {}) {
  const { opened, factory, host, calls } = fake()
  const events: [string, unknown][] = []
  const states: SocketState[] = []
  let restarts = 0
  const socket = new RuntimeSocket({
    url: 'https://studio.example:7788',
    token: 'secret-token',
    factory,
    onEvent: (channel, payload) => events.push([channel, payload]),
    onState: (state) => states.push(state),
    onRestart: () => restarts++,
    random: () => 0,
    ...extra,
  })
  return { socket, opened, host, calls, events, states, restarts: () => restarts }
}

it('connects over wss with the token in a header, never in the URL, and is ready only after the host says so', () => {
  const { socket, opened, host, states } = make()
  socket.start()
  expect(opened[0]!.url).toBe('wss://studio.example:7788/socket')
  expect(opened[0]!.url).not.toContain('secret')
  expect(opened[0]!.headers.Authorization).toBe('Bearer secret-token')
  opened[0]!.handlers.onopen()
  expect(socket.state).toBe('connecting')
  host(0, { t: 'ready', epoch: 'e1' })
  expect(states).toEqual(['connecting', 'ready'])
  socket.close()
})

it('matches answers to calls by id, carries the operation key and delivers events', async () => {
  const { socket, host, calls, events } = make()
  socket.start()
  host(0, { t: 'ready', epoch: 'e1' })
  const first = socket.invoke('agent.send', ['a', undefined], { operationKey: 'operation-key-1' })
  // A method the result table does not list is not checked.
  const second = socket.invoke('test.echo', [])
  const [one, two] = calls(0)
  expect(one).toMatchObject({ method: 'agent.send', args: ['a', undefined], operationKey: 'operation-key-1' })
  host(0, { t: 'event', channel: 'automation:changed', payload: { n: 1 } })
  host(0, { t: 'result', id: two!.id, value: ['x'] })
  host(0, { t: 'error', id: one!.id, error: 'Not allowed', status: 403 })
  await expect(second).resolves.toEqual(['x'])
  await expect(first).rejects.toMatchObject({ message: 'Not allowed', status: 403 })
  expect(isTransportFailure(await first.catch((error) => error))).toBe(false)
  expect(events).toEqual([['automation:changed', { n: 1 }]])
  socket.close()
})

it('settles pending calls as an unknown outcome when the connection drops, then reconnects with a growing delay', async () => {
  const { socket, opened, host, states } = make()
  socket.start()
  host(0, { t: 'ready', epoch: 'e1' })
  const pending = socket.invoke('agent.send', ['a'])
  opened[0]!.handlers.onclose({})
  const error = await pending.catch((reason) => reason)
  expect(isTransportFailure(error)).toBe(true)
  expect(states.at(-1)).toBe('closed')
  // The first retry waits at least half of the base delay; the next one doubles.
  await vi.advanceTimersByTimeAsync(499)
  expect(opened).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(2)
  expect(opened).toHaveLength(2)
  opened[1]!.handlers.onclose({})
  await vi.advanceTimersByTimeAsync(999)
  expect(opened).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(2)
  expect(opened).toHaveLength(3)
  socket.close()
})

it('tells the app when the host restarted, and stops for refused credentials or a host without sockets', () => {
  const restarted = make()
  restarted.socket.start()
  restarted.host(0, { t: 'ready', epoch: 'e1' })
  restarted.opened[0]!.handlers.onclose({})
  vi.advanceTimersByTime(1000)
  restarted.host(1, { t: 'ready', epoch: 'e2' })
  expect(restarted.restarts()).toBe(1)
  restarted.socket.close()

  const refused = make()
  refused.socket.start()
  refused.opened[0]!.handlers.onclose({ status: 401 })
  vi.advanceTimersByTime(60_000)
  expect(refused.socket.state).toBe('rejected')
  expect(refused.opened).toHaveLength(1)

  const old = make()
  old.socket.start()
  old.opened[0]!.handlers.onclose({ status: 404 })
  vi.advanceTimersByTime(60_000)
  expect(old.socket.state).toBe('unsupported')
  expect(old.opened).toHaveLength(1)
})

it('refuses calls at once when not connected, times out a silent host and honors an abort', async () => {
  const { socket, host } = make()
  await expect(socket.invoke('agent.list')).rejects.toMatchObject({ code: 'ECONNRESET' })
  socket.start()
  host(0, { t: 'ready', epoch: 'e1' })
  const silent = socket.invoke('agent.list', [], { timeoutMs: 1000 })
  const caught = silent.catch((error) => error)
  await vi.advanceTimersByTimeAsync(1001)
  expect(isTransportFailure(await caught)).toBe(true)
  const controller = new AbortController()
  const aborted = socket.invoke('agent.list', [], { signal: controller.signal })
  controller.abort()
  await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })
  socket.close()
})

it('drops a connection whose host stops answering heartbeats', async () => {
  const { socket, opened, host } = make({ heartbeatMs: 1000 })
  socket.start()
  host(0, { t: 'ready', epoch: 'e1' })
  await vi.advanceTimersByTimeAsync(1000)
  expect(opened[0]!.sent.map((text) => decodeSocketFrame(text, 'client'))).toContainEqual({ t: 'ping' })
  await vi.advanceTimersByTimeAsync(3000)
  expect(opened[0]!.closed).toBe(true)
  socket.close()
})

it('judges the host on the next beat after a pause of its own, when the answers that waited have been read', async () => {
  const { socket, opened, host } = make({ heartbeatMs: 1000 })
  socket.start()
  host(0, { t: 'ready', epoch: 'e1' })
  // This process was busy for several beats: nothing it was sent has been read yet.
  vi.setSystemTime(Date.now() + 5000)
  await vi.advanceTimersByTimeAsync(1000)
  expect(opened[0]!.closed).toBe(false)
  host(0, { t: 'pong' })
  await vi.advanceTimersByTimeAsync(1000)
  expect(opened[0]!.closed).toBe(false)
  socket.close()
})

it('asks to catch up rather than be dropped when it can, and hears when it must', () => {
  let caughtUp = 0
  const { socket, opened, host, states } = make({ onCatchUp: () => caughtUp++ })
  socket.start()
  expect(new URL(opened[0]!.url).searchParams.get('catchup')).toBe('1')
  host(0, { t: 'ready', epoch: 'e1' })
  host(0, { t: 'resync' })
  expect(caughtUp).toBe(1)
  // The connection stays as it was: catching up is not a reconnect.
  expect(states).toEqual(['connecting', 'ready'])
  socket.close()
  const plain = make()
  plain.socket.start()
  expect(new URL(plain.opened[0]!.url).searchParams.has('catchup')).toBe(false)
  plain.socket.close()
})

it('sends its subscription once ready and restores it on every reconnect', () => {
  const { socket, opened, host } = make()
  const subscriptions = (index: number) =>
    opened[index]!.sent.map((text) => decodeSocketFrame(text, 'client')).filter((frame) => frame?.t === 'subscribe')
  socket.start()
  socket.subscribe(['agent:event'], { 'agent:event': ['s1'] }).catch(() => {})
  host(0, { t: 'ready', epoch: 'e1' })
  expect(subscriptions(0)).toMatchObject([{ channels: ['agent:event'], keys: { 'agent:event': ['s1'] } }])
  socket.subscribe(['term:data']).catch(() => {})
  expect(subscriptions(0)).toHaveLength(2)
  socket.subscribe(['agent:event'], { 'agent:event': ['s1'] }, { 'agent:event': ['text'] }).catch(() => {})
  expect(subscriptions(0).at(-1)).toMatchObject({ skip: { 'agent:event': ['text'] } })
  socket.subscribe(['term:data']).catch(() => {})
  opened[0]!.handlers.onclose({})
  vi.advanceTimersByTime(2000)
  host(1, { t: 'ready', epoch: 'e1' })
  expect(subscriptions(1)).toMatchObject([{ channels: ['term:data'] }])
})

it('with flow control asks for it, acknowledges each terminal chunk after delivering it, and ignores other events', () => {
  const { socket, opened, host, events } = make({ flowControl: true })
  socket.start()
  host(0, { t: 'ready', epoch: 'e1' })
  socket.subscribe(['term:data', 'term:behind'], { 'term:data': ['a'] }).catch(() => {})
  const sent = () => opened[0]!.sent.map((text) => decodeSocketFrame(text, 'client'))
  expect(sent().find((frame) => frame?.t === 'subscribe')).toMatchObject({ flow: true })

  host(0, { t: 'event', channel: 'term:data', payload: { id: 'a', data: 'hello', cursor: 5 } })
  host(0, { t: 'event', channel: 'term:behind', payload: { id: 'a' } })
  host(0, { t: 'event', channel: 'term:data', payload: { id: 'a', data: '' } })
  expect(events.map(([channel]) => channel)).toEqual(['term:data', 'term:behind', 'term:data'])
  expect(sent().filter((frame) => frame?.t === 'ack')).toEqual([{ t: 'ack', id: 'a', bytes: 5 }])
  socket.close()
})

it('does not acknowledge or ask for flow control unless enabled', () => {
  const { socket, opened, host } = make()
  socket.start()
  host(0, { t: 'ready', epoch: 'e1' })
  socket.subscribe(['term:data']).catch(() => {})
  host(0, { t: 'event', channel: 'term:data', payload: { id: 'a', data: 'hello' } })
  const frames = opened[0]!.sent.map((text) => decodeSocketFrame(text, 'client'))
  expect(frames.some((frame) => frame?.t === 'ack')).toBe(false)
  expect(frames.find((frame) => frame?.t === 'subscribe')).not.toHaveProperty('flow')
  socket.close()
})

it('refuses an answer whose shape the method does not declare, naming the field', async () => {
  const { socket, host, calls } = make()
  socket.start()
  host(0, { t: 'ready', epoch: 'e1' })
  const listed = socket.invoke('agent.list', ['t'])
  host(0, { t: 'result', id: calls(0)[0]!.id, value: ['not a session'] })
  await expect(listed).rejects.toThrow(
    'The host answered agent.list in a shape this app does not know (result[0]: expected an object',
  )
  socket.close()
})
