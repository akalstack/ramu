import { afterEach, expect, it, vi } from 'vitest'
import type { NetworkMonitor, NetworkState } from '../src/network'
import { closeHostSockets, subscribeRuntime } from '../src'
import { socketHost } from './support/socketHost'

const hosts: Awaited<ReturnType<typeof socketHost>>[] = []
let stop: (() => void) | undefined
afterEach(async () => {
  stop?.()
  stop = undefined
  closeHostSockets()
  for (const host of hosts.splice(0)) await host.close()
})

async function setup(
  options: { available?: boolean; refuse?: number; policy?: Parameters<typeof subscribeRuntime>[3] } = {},
) {
  const host = await socketHost(options.refuse ? { refuse: options.refuse } : {})
  hosts.push(host)
  let state: NetworkState = { available: options.available ?? true, fingerprint: 'initial' }
  const listeners = new Set<(force?: boolean) => void>()
  const monitor: NetworkMonitor = {
    current: () => state,
    subscribe: (notify) => {
      listeners.add(notify)
      return () => listeners.delete(notify)
    },
  }
  const receive = vi.fn()
  // A non-loopback name makes the subscription depend on the network monitor; 127.0.0.1 would ignore it.
  const url = new URL(host.url)
  url.hostname = 'localhost'
  const endpoint = { kind: 'http' as const, url: url.toString().replace(/\/$/, ''), token: 'secret' }
  const loopbackNeedsNoNetwork = true
  void loopbackNeedsNoNetwork
  stop = subscribeRuntime(endpoint, receive, monitor, options.policy)
  return {
    host,
    receive,
    listeners,
    change: (available: boolean, force = false) => {
      state = { available, fingerprint: String(Math.random()) }
      for (const notify of listeners) notify(force)
    },
  }
}
const connected = (receive: ReturnType<typeof vi.fn>) =>
  receive.mock.calls.filter(([, payload]) => payload.connected === true).length
const upgrades = (host: { upgrades: unknown[] }) => host.upgrades.length

it('tries briefly, then stops probing until an announcement wakes it', async () => {
  let wake!: () => void
  const unwatch = vi.fn()
  const { host, receive } = await setup({
    refuse: 503,
    policy: {
      retryMode: 'events',
      networkBound: true,
      watchWake: (callback) => {
        wake = callback
        return unwatch
      },
    },
  })
  await expect.poll(() => upgrades(host), { timeout: 15_000 }).toBe(4)
  await new Promise((resolve) => setTimeout(resolve, 2500))
  expect(upgrades(host)).toBe(4)
  expect(receive).toHaveBeenCalledWith('background:connection', { connected: false, waiting: 'computer' })
  wake()
  await expect.poll(() => upgrades(host)).toBeGreaterThanOrEqual(5)
  stop!()
  expect(unwatch).toHaveBeenCalledTimes(1)
}, 25_000)

it('sends nothing without a network and connects as soon as an interface returns', async () => {
  const { host, receive, change } = await setup({ available: false, policy: { networkBound: true } })
  await new Promise((resolve) => setTimeout(resolve, 600))
  expect(upgrades(host)).toBe(0)
  expect(receive).toHaveBeenLastCalledWith('background:connection', { connected: false, waiting: 'network' })
  change(true)
  await expect.poll(() => connected(receive)).toBe(1)
})

it('closes the connection when the network goes away, without a retry loop', async () => {
  const { host, receive, change } = await setup({ policy: { networkBound: true } })
  await expect.poll(() => connected(receive)).toBe(1)
  change(false)
  await expect.poll(() => host.open()).toBe(0)
  await new Promise((resolve) => setTimeout(resolve, 2500))
  expect(upgrades(host)).toBe(1)
  expect(receive).toHaveBeenLastCalledWith('background:connection', { connected: false, waiting: 'network' })
  change(true)
  await expect.poll(() => connected(receive)).toBe(2)
})

it('a network change leaves an established connection alone, but a wake may replace a stale one', async () => {
  const { host, receive, change } = await setup({ policy: { networkBound: true } })
  await expect.poll(() => connected(receive)).toBe(1)
  change(true)
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(upgrades(host)).toBe(1)
  change(true, true)
  await expect.poll(() => connected(receive)).toBe(2)
  expect(upgrades(host)).toBe(2)
})

it('a rejected token never retries and releases the network observer', async () => {
  const host = await socketHost({ token: 'other' })
  hosts.push(host)
  const listeners = new Set<unknown>()
  const monitor: NetworkMonitor = {
    current: () => ({ available: true, fingerprint: 'x' }),
    subscribe: (notify) => {
      listeners.add(notify)
      return () => listeners.delete(notify)
    },
  }
  const receive = vi.fn()
  stop = subscribeRuntime({ ...host.endpoint, token: 'wrong' }, receive, monitor, { networkBound: true })
  await expect.poll(() => receive.mock.calls.length).toBe(1)
  expect(receive).toHaveBeenCalledWith('background:connection', { connected: false, rejected: true })
  expect(listeners.size).toBe(0)
  await new Promise((resolve) => setTimeout(resolve, 1500))
  expect(upgrades(host)).toBe(1)
})

it('stopping releases the network observer and ends the subscription', async () => {
  const { listeners, host, receive } = await setup({ policy: { networkBound: true } })
  await expect.poll(() => connected(receive)).toBe(1)
  stop!()
  expect(listeners.size).toBe(0)
  host.push('automation:changed')
  await new Promise((resolve) => setTimeout(resolve, 200))
  expect(receive.mock.calls.some(([channel]) => channel === 'automation:changed')).toBe(false)
})
