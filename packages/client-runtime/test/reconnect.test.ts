import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { NetworkMonitor, NetworkState } from '../src/network'

const requests = vi.hoisted(() => [] as { request: any; respond: (response: any) => void }[])
vi.mock('node:http', async () => {
  const { EventEmitter } = await import('node:events')
  return { request: vi.fn((_options, respond) => {
    const request = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn(function (this: EventEmitter) { this.emit('close') }) })
    requests.push({ request, respond })
    return request
  }) }
})
import { subscribeRuntime } from '../src'

let stop: () => void
beforeEach(() => { vi.useFakeTimers(); requests.length = 0 })
afterEach(() => { stop?.(); vi.useRealTimers() })

function setup(available = true, policy: Parameters<typeof subscribeRuntime>[3] = {}) {
  let state: NetworkState = { available, fingerprint: 'initial' }
  const listeners = new Set<(force?: boolean) => void>()
  const monitor: NetworkMonitor = { current: () => state, subscribe: (notify) => { listeners.add(notify); return () => { listeners.delete(notify) } } }
  const receive = vi.fn()
  stop = subscribeRuntime({ kind: 'http', url: 'http://10.0.0.2:7788', token: 'token' }, receive, monitor, policy)
  return { receive, listeners, change: (available: boolean, force = false) => { state = { available, fingerprint: String(Date.now()) }; for (const notify of listeners) notify(force) } }
}
const fail = () => requests.at(-1)!.request.emit('error', new Error('Host unreachable'))
function response(statusCode = 200) {
  const res = Object.assign(new EventEmitter(), { statusCode, resume: vi.fn(), setEncoding: vi.fn(), destroy: vi.fn() })
  requests.at(-1)!.respond(res)
  return res
}

it('tries briefly then makes only one quiet availability check per five minutes', async () => {
  setup()
  fail()
  await vi.advanceTimersByTimeAsync(1000); fail()
  await vi.advanceTimersByTimeAsync(2000); fail()
  await vi.advanceTimersByTimeAsync(4000); fail()
  expect(requests).toHaveLength(4)
  await vi.advanceTimersByTimeAsync(299999)
  expect(requests).toHaveLength(4)
  await vi.advanceTimersByTimeAsync(1)
  expect(requests).toHaveLength(5)
})

it('event mode stops probing and an announcement wakes only its offline connection', async () => {
  let wake!: () => void
  const unwatch = vi.fn()
  setup(true, { retryMode: 'events', watchWake: (callback) => { wake = callback; return unwatch } })
  fail()
  await vi.advanceTimersByTimeAsync(1000); fail()
  await vi.advanceTimersByTimeAsync(2000); fail()
  await vi.advanceTimersByTimeAsync(4000); fail()
  await vi.advanceTimersByTimeAsync(3600000)
  expect(requests).toHaveLength(4)
  wake(); wake()
  expect(requests).toHaveLength(5)
  response()
  wake()
  expect(requests).toHaveLength(5)
  stop()
  expect(unwatch).toHaveBeenCalledTimes(1)
})

it('sends no requests without a network and wakes as soon as an interface returns', async () => {
  const { receive, change } = setup(false)
  await vi.advanceTimersByTimeAsync(600000)
  expect(requests).toHaveLength(0)
  expect(receive).toHaveBeenLastCalledWith('background:connection', { connected: false, waiting: 'network', retryAt: undefined })
  change(true)
  expect(requests).toHaveLength(1)
})

it('closes a stream when the network goes away, without starting a retry loop', async () => {
  const { change } = setup()
  response()
  change(false)
  expect(requests[0]!.request.destroy).toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(600000)
  expect(requests).toHaveLength(1)
  change(true)
  expect(requests).toHaveLength(2)
})

it('a network change skips the wait but leaves an established connection alone', () => {
  const { change } = setup()
  fail()
  change(true)
  expect(requests).toHaveLength(2)
  response()
  change(true)
  expect(requests).toHaveLength(2)
})

it('waking replaces a possibly stale stream even when the addresses did not change', () => {
  const { change } = setup()
  response()
  change(true, true)
  expect(requests).toHaveLength(2)
  expect(requests[0]!.request.destroy).toHaveBeenCalled()
})

it('bounds stalled connections and detects a silent event stream', async () => {
  setup()
  await vi.advanceTimersByTimeAsync(10000)
  expect(requests[0]!.request.destroy).toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1000)
  const res = response()
  await vi.advanceTimersByTimeAsync(59000)
  res.emit('data', ': heartbeat\n\n')
  await vi.advanceTimersByTimeAsync(59000)
  expect(requests).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(1000)
  expect(requests[1]!.request.destroy).toHaveBeenCalled()
})

it('a rejected token never wakes or retries and releases the network observer', async () => {
  const { change, listeners } = setup()
  response(401)
  expect(listeners.size).toBe(0)
  change(true)
  await vi.advanceTimersByTimeAsync(600000)
  expect(requests).toHaveLength(1)
})

it('stopping cancels requests, delayed checks and network observers', async () => {
  const { listeners, change } = setup()
  fail()
  stop()
  change(true)
  await vi.advanceTimersByTimeAsync(600000)
  expect(requests).toHaveLength(1)
  expect(listeners.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})
