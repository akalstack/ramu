import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WebSocketServer, type WebSocket as NodeWebSocket } from 'ws'
import { RuntimeSocket } from '@ramu/client-runtime/socket'
import { nodeSocketFactory } from '@ramu/client-runtime'
import { linkFetch, linkSocketFactory, type LinkClientOptions } from '@ramu/shared/link/client'
import { generateKeyPair } from '@ramu/shared/link/noise'
import {
  LINK_CLOSE,
  LINK_PROTOCOL,
  MUX,
  credentialFromProtocols,
  decodeMux,
  encodeMux,
  linkAddress,
} from '@ramu/shared/link/protocol'
import { requestPairing } from '@ramu/shared/pairRequest'
import { RemoteAccess } from '../src/remote/access'
import { DeviceStore } from '../src/remote/devices'
import { PairingRequests } from '../src/remote/pairingRequests'
import { RelayClient } from '../src/remote/link/relayClient'
import { serveSockets } from '../src/remote/socket'

const random = (bytes: number) => new Uint8Array(randomBytes(bytes))
const HOST = 'abcdefabcdefabcdefabcdefabcdef12'
const cleanup: (() => unknown)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

/** The Durable Object's routing, in Node: one host socket, one socket per device stream. */
async function fakeRelay() {
  const wss = new WebSocketServer({ port: 0, handleProtocols: () => LINK_PROTOCOL })
  await new Promise<void>((resolve) => wss.once('listening', resolve))
  let host: NodeWebSocket | null = null
  const devices = new Map<number, NodeWebSocket>()
  let next = 1
  wss.on('connection', (ws, req) => {
    if (req.url === '/v1/relay/host') {
      if (credentialFromProtocols(req.headers['sec-websocket-protocol'] ?? null, 'host') !== 'secret')
        return ws.close(LINK_CLOSE.unauthorized)
      host = ws
      ws.on('message', (data) => {
        const frame = decodeMux(new Uint8Array(data as Buffer))
        if (!frame) return
        const device = devices.get(frame.stream)
        if (frame.type === MUX.data) device?.send(frame.payload)
        else if (frame.type === MUX.close) device?.close(LINK_CLOSE.hostClosed)
      })
      ws.on('close', () => (host = null))
      return
    }
    if (!host) return ws.close(LINK_CLOSE.hostOffline)
    const stream = next++
    devices.set(stream, ws)
    host.send(encodeMux(MUX.open, stream, new TextEncoder().encode('{"account":"u1"}')))
    ws.on('message', (data) => host?.send(encodeMux(MUX.data, stream, new Uint8Array(data as Buffer))))
    ws.on('close', () => {
      devices.delete(stream)
      host?.send(encodeMux(MUX.close, stream))
    })
  })
  cleanup.push(() => new Promise((resolve) => wss.close(resolve)))
  return `http://127.0.0.1:${(wss.address() as { port: number }).port}`
}

async function fixture(options: { connectHost?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-link-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const identity = generateKeyPair(random)
  const hostKey = Buffer.from(identity.publicKey).toString('hex')
  const devices = new DeviceStore(join(dir, 'devices.json'))
  const pairing = new PairingRequests({
    devices,
    hostId: HOST,
    accepting: (peer) => peer.startsWith('link:'),
    linkKey: () => hostKey,
  })
  const access = new RemoteAccess({ devices, hostId: HOST, browserOrigins: [], pairing, linkKey: () => hostKey })
  const peers: string[] = []
  // The server the host bridges Link streams into: never listening, like the real one.
  const server: Server = createServer(async (req, res) => {
    peers.push(req.socket.remoteAddress ?? '')
    const device = await access.accept(req, res)
    if (device === undefined) return
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ device: device?.id ?? null }))
  })
  const sockets = serveSockets(server, {
    accept: (req, res) => access.accept(req, res),
    invoke: async (device, request) => ({ ok: true, value: { method: request.method, device: device?.id } }),
    epoch: 'e1',
    attach: () => {},
    detach: () => {},
  })
  cleanup.push(() => sockets.close())
  const service = await fakeRelay()
  const states: string[] = []
  const relay = new RelayClient({
    service,
    hostId: HOST,
    secret: 'secret',
    identity,
    server,
    onState: (state) => states.push(state),
  })
  cleanup.push(() => relay.stop())
  if (options.connectHost !== false) {
    relay.start()
    await expect.poll(() => relay.state).toBe('online')
  }
  let pinned: string | null = null
  const client: LinkClientOptions = {
    account: () => ({ service, token: 'session' }),
    pinned: () => pinned,
    random,
  }
  return {
    devices,
    pairing,
    hostKey,
    peers,
    states,
    relay,
    client,
    pin: (key: string | null) => (pinned = key),
    fetch: linkFetch(client, fetch),
  }
}

it('answers HTTP through the relay, sealed end to end, with the Link account as the peer', async () => {
  const f = await fixture()
  const health = await f.fetch(`${linkAddress(HOST)}/health`)
  expect(health.status).toBe(200)
  expect(await health.json()).toMatchObject({ ok: true })
  const refused = await f.fetch(`${linkAddress(HOST)}/session`)
  expect(refused.status).toBe(401)
  expect(f.peers.at(-1)).toBe('link:u1')
})

it('pairs with a code and then runs the Ramu socket through Link', async () => {
  const f = await fixture()
  const { code } = f.devices.createCode(Date.now(), 'owner')
  const paired = await f.fetch(`${linkAddress(HOST)}/pair`, {
    method: 'POST',
    body: JSON.stringify({ code, name: 'Phone' }),
  })
  expect(paired.status).toBe(200)
  const { token, deviceId } = (await paired.json()) as { token: string; deviceId: string }
  f.pin(f.hostKey)
  const socket = new RuntimeSocket({
    url: linkAddress(HOST),
    token,
    factory: linkSocketFactory(f.client, nodeSocketFactory),
    onEvent: () => {},
  })
  cleanup.push(() => socket.close())
  socket.start()
  await socket.whenReady()
  await expect(socket.invoke('agent.list', [])).resolves.toEqual({ method: 'agent.list', device: deviceId })
})

it('pairs by request through Link and returns the host key the host vouched for', async () => {
  const f = await fixture()
  const post = async (path: string, body: unknown, signal: AbortSignal) => {
    const response = await f.fetch(`${linkAddress(HOST)}${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  const result = requestPairing({
    post,
    name: 'Phone',
    random,
    // The code is shown once the host has the request; approve it as the person at the host would.
    onCode: () => {
      const [request] = f.pairing.list()
      if (request) f.pairing.approve(request.id, 'owner')
    },
    signal: new AbortController().signal,
  })
  await expect(result).resolves.toMatchObject({ hostId: HOST, linkKey: f.hostKey })
})

it('refuses a host proving a different key than the one pinned', async () => {
  const f = await fixture()
  f.pin('0'.repeat(64))
  await expect(f.fetch(`${linkAddress(HOST)}/health`)).rejects.toThrow('identity changed')
})

it('reports an offline host to the device, and sends other addresses to the normal fetch', async () => {
  const f = await fixture({ connectHost: false })
  await expect(f.fetch(`${linkAddress(HOST)}/health`)).rejects.toThrow('not connected to Ramu Link')
  const fallback = linkFetch(f.client, (async () => new Response('direct')) as typeof fetch)
  expect(await (await fallback('http://192.168.1.2:7788/health')).text()).toBe('direct')
})

it('stops reconnecting when the relay no longer accepts the host', async () => {
  const f = await fixture({ connectHost: false })
  const relay = new RelayClient({
    service: (f.client.account() as { service: string }).service,
    hostId: HOST,
    secret: 'wrong',
    identity: generateKeyPair(random),
    server: createServer(),
    onState: () => {},
  })
  cleanup.push(() => relay.stop())
  relay.start()
  await expect.poll(() => relay.state).toBe('unauthorized')
})
