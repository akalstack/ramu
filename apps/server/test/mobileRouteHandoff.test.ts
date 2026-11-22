import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { RuntimeSocket, nodeSocketFactory } from '@ramu/client-runtime'
import { DeviceStore } from '../src/remote/devices'
import { RemoteAccess } from '../src/remote/access'
import { serveSockets, type EventSink } from '../src/remote/socket'
import { findHostRoute, rememberRoutes, verifyHost } from '../../mobile/src/runtime/hostRoutes'
import { probeReachableHosts } from '../../mobile/src/runtime/reachableHosts'
import type { NearbyHost } from '@ramu/shared/discovery/tracker'
import { HostClient, registerSocketProvider, type HostSocket } from '../../mobile/src/runtime/transport'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  registerSocketProvider(null)
  for (const close of cleanup.splice(0).reverse()) await close()
})

/** Uses the real mobile client and socket protocol; only the platform WebSocket adapter is Node's. */
function installSockets() {
  const entries = new Map<string, { socket: RuntimeSocket; api: HostSocket }>()
  registerSocketProvider(
    (address, token) => {
      const key = `${address}#${token}`
      const existing = entries.get(key)
      if (existing) return existing.api
      const listeners = new Set<Parameters<HostSocket['listen']>[0]>()
      const socket = new RuntimeSocket({
        url: address,
        token,
        factory: nodeSocketFactory,
        heartbeatMs: 100,
        connectTimeoutMs: 500,
        onEvent: (channel, payload) => listeners.forEach((l) => l.event(channel, payload)),
        onState: (state) => listeners.forEach((l) => l.state?.(state)),
      })
      const api: HostSocket = {
        get state() {
          return socket.state
        },
        whenReady: (timeout, signal) => socket.whenReady(timeout, signal),
        invoke: (method, args, options) => socket.invoke(method, args, options),
        watch: () => () => {},
        listen: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
      entries.set(key, { socket, api })
      socket.start()
      return api
    },
    (address, token) => {
      const key = `${address}#${token}`
      entries.get(key)?.socket.close()
      entries.delete(key)
    },
  )
  cleanup.push(() => {
    for (const { socket } of entries.values()) socket.close()
  })
}

it('pairs once, loses LAN during an action, switches to VPN, and returns to LAN without replaying the action', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-mobile-handoff-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const devices = new DeviceStore(join(dir, 'devices.json'))
  const hostId = 'a'.repeat(32)
  const routes: string[] = []
  const access = new RemoteAccess({ devices, hostId, routes: () => routes, browserOrigins: [] })
  let mutations = 0
  const identityHeaders: unknown[] = []
  const endpoint = async (blockedSocket = false) => {
    let online = true
    const sinks = new Set<EventSink>()
    const accept = async (req: IncomingMessage, res: ServerResponse) => {
      if (!online) {
        res.writeHead(503).end()
        return undefined
      }
      if (req.url?.startsWith('/identity')) identityHeaders.push(req.headers.authorization)
      return access.accept(req, res)
    }
    const server = createServer(async (req, res) => {
      if ((await accept(req, res)) !== undefined) res.writeHead(200).end('ok')
    })
    const sockets = serveSockets(server, {
      accept: async (req, res) => {
        if (blockedSocket) {
          res.writeHead(503).end()
          return undefined
        }
        return accept(req, res)
      },
      epoch: 'same-host',
      attach: (sink) => {
        sinks.add(sink)
      },
      detach: (sink) => {
        sinks.delete(sink)
      },
      invoke: async (_device, request) => {
        if (request.method === 'background.status')
          return {
            ok: true,
            value: {
              protocol: 1,
              running: true,
              pid: 1,
              startedAt: 0,
              loginEnabled: false,
              os: { os: 'macos', form: 'computer' },
            },
          }
        if (request.method === 'tasks.rename') {
          mutations++
          online = false
          for (const sink of sinks) sink.destroy()
        }
        // The fake host answers its own test method with how many renames it ran; real methods answer empty lists.
        return { ok: true, value: request.method === 'test.mutations' ? { mutations } : [] }
      },
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    cleanup.push(async () => {
      sockets.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })
    return {
      address,
      offline: () => {
        online = false
        for (const sink of sinks) sink.destroy()
      },
      online: () => {
        online = true
      },
    }
  }
  const lan = await endpoint(),
    vpn = await endpoint(),
    blocked = await endpoint(true)
  routes.push(lan.address, blocked.address, vpn.address)
  const code = devices.createCode().code
  const response = await fetch(`${lan.address}/pair`, { method: 'POST', body: JSON.stringify({ code, name: 'Phone' }) })
  const paired = (await response.json()) as { token: string; deviceId: string; hostId: string }
  expect(paired.hostId).toBe(hostId)
  installSockets()
  let challenge = 0
  const verify = (address: string, signal: AbortSignal) =>
    verifyHost({
      fetch,
      baseUrl: address,
      deviceId: paired.deviceId,
      token: paired.token,
      expectedHostId: paired.hostId,
      challenge: `fresh-challenge-${++challenge}-0123456789`,
      signal,
    })
  const identity = await verify(lan.address, AbortSignal.timeout(2000))
  expect(identity.state).toBe('verified')
  if (identity.state !== 'verified') throw Error('Pairing identity was not proven')
  const usable = async (address: string, signal: AbortSignal) => {
    const probe = new HostClient(address, paired.token, fetch)
    const close = () => probe.close()
    signal.addEventListener('abort', close, { once: true })
    try {
      const status = await probe.invoke('background.status')
      return status.protocol === 1
    } finally {
      signal.removeEventListener('abort', close)
      close()
    }
  }
  const original = new HostClient(lan.address, paired.token, fetch)
  cleanup.push(() => original.close())
  await original.invoke('projects.list')
  const stream = original.stream(
    () => {},
    async () => {},
    new AbortController().signal,
  )
  // Attach rejection handling before the action deliberately drops the live stream.
  const dropped = expect(stream).rejects.toThrow('disconnected')
  await expect(original.invoke('tasks.rename', 'thread', 'new title')).rejects.toMatchObject({ ambiguous: true })
  await dropped
  original.close()
  const nearby: NearbyHost[] = []
  await probeReachableHosts({
    computers: [
      {
        id: 'saved-mac',
        name: 'Work Mac',
        hostId: paired.hostId,
        deviceId: paired.deviceId,
        address: lan.address,
        routes: identity.routes,
        status: 'offline',
        os: 'macos',
        lastSeen: 0,
      },
    ],
    tokenFor: async () => paired.token,
    fetch,
    signal: AbortSignal.timeout(5000),
    found: (host) => nearby.push(host),
  })
  expect(nearby).toHaveLength(1)
  expect(nearby[0]?.pairedHostId).toBe('saved-mac')
  expect(nearby[0]?.routes[0]?.url).toBe(vpn.address)
  const moved = await findHostRoute({
    address: lan.address,
    routes: identity.routes,
    signal: AbortSignal.timeout(5000),
    verify,
    usable,
  })
  expect(moved?.address).toBe(vpn.address)
  const remote = new HostClient(moved!.address, paired.token, fetch)
  cleanup.push(() => remote.close())
  expect(await mutationsOn(remote)).toBe(1)
  const saved = rememberRoutes(lan.address, moved!.routes, identity.routes)
  vpn.offline()
  remote.close()
  lan.online()
  const returned = await findHostRoute({
    address: vpn.address,
    routes: saved,
    signal: AbortSignal.timeout(5000),
    verify,
    usable,
  })
  expect(returned?.address).toBe(lan.address)
  const home = new HostClient(returned!.address, paired.token, fetch)
  cleanup.push(() => home.close())
  expect(await mutationsOn(home)).toBe(1)
  expect(identityHeaders.length).toBeGreaterThan(2)
  expect(identityHeaders.every((header) => header === undefined)).toBe(true)
})

/** How many renames the fake host ran, through a method only the fake knows, so no declared result applies. */
const mutationsOn = async (client: HostClient) =>
  ((await (client.invoke as (method: string) => Promise<unknown>)('test.mutations')) as { mutations: number }).mutations
