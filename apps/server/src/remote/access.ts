import type { IncomingMessage, ServerResponse } from 'node:http'
import { CHALLENGE_PATTERN, IDENTITY_PATH, PAIR_PATH, PROTOCOL_VERSION, RENEW_PATH, SOCKET_PATH } from '@ramu/contracts'
import { PROOF_HEADER } from '@ramu/shared/deviceProof'
import { viewerMayInvoke } from '@ramu/shared/viewerAccess'
import { permissionFor, permissionRefusal, type DevicePermission } from '@ramu/shared/devicePermissions'
import { hostProof } from '@ramu/shared/hostProof'
import type { DeviceInfo, DeviceStore } from './devices'
import { PAIR_REQUEST_PATH, PAIR_REVEAL_PATH, PAIR_WAIT_PATH } from '@ramu/shared/pairRequest'
import { PairingError, type PairingRequests } from './pairingRequests'

/**
 * Everything a paired host may call here: start, check, message and stop the threads it started, list projects to
 * name them by name, and offer its tools for a review here. Nothing that reads files, paths, Git, terminals, settings or
 * other threads, and nothing that installs.
 */
export const HOST_METHODS: ReadonlySet<string> = new Set([
  'hostThreads.start',
  'hostThreads.status',
  'hostThreads.message',
  'hostThreads.projects',
  'hostThreads.stop',
  'hostTools.offer',
])

export const deviceMayInvoke = (device: DeviceInfo | undefined, method: string): boolean =>
  device?.kind === 'host'
    ? HOST_METHODS.has(method)
    : !method.startsWith('hostThreads.') &&
      !method.startsWith('hostTools.') &&
      !method.startsWith('terminalThreads.') &&
      (device?.role !== 'viewer' || viewerMayInvoke(method))
/**
 * Why a paired device may not make this call here, or null when it may: the role and kind come first, then the
 * device's own grant for computer use, the browser, terminals, settings changes or agents. A missing grant is named so
 * the device can ask the person here for it.
 */
export function remoteRefusal(
  device: DeviceInfo | undefined,
  method: string,
  allows: (deviceId: string, permission: DevicePermission) => boolean,
): string | null {
  if (!deviceMayInvoke(device, method))
    return device?.kind === 'host'
      ? 'A paired host may only start, check and message the threads it starts here, and offer its tools.'
      : method.startsWith('hostThreads.') || method.startsWith('hostTools.')
        ? 'Only a paired host can make this call.'
        : 'This device is a viewer. This action requires full access.'
  const needed = device ? permissionFor(method) : null
  return device && needed && !allows(device.id, needed) ? permissionRefusal(needed) : null
}
/** Tailscale's own addresses: its traffic is WireGuard-encrypted end to end, whatever the listener speaks. */
const TAILSCALE = /^(::ffff:)?100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|^fd7a:115c:a1e0:/i
const LOOPBACK = /^(::ffff:)?127\.|^::1$/

/**
 * Whether a connection keeps what crosses it private: TLS, this computer itself (a tunnel delivers here from loopback,
 * and a public address is always HTTPS), or Tailscale. A plain-HTTP listener on a trusted network is not.
 */
export function encryptedConnection(socket: { encrypted?: boolean; remoteAddress?: string } | undefined): boolean {
  if (!socket) return false
  if (socket.encrypted) return true
  const address = socket.remoteAddress ?? ''
  return LOOPBACK.test(address) || TAILSCALE.test(address)
}

/**
 * Whether a caller may set up this host's providers, accounts, keys and connections. The person here always may. From
 * another device it takes full access, that device's Change settings permission, and an encrypted connection, since
 * these calls carry sign-ins and keys; a key sent is stored here and never shown again.
 */
export function mayAdministerIntegrations(
  caller: { network: boolean; device?: DeviceInfo; encrypted?: boolean },
  allows: (deviceId: string, permission: DevicePermission) => boolean,
): boolean {
  if (!caller.network) return true
  const device = caller.device
  return (
    !!device &&
    device.kind !== 'host' &&
    device.role !== 'viewer' &&
    caller.encrypted === true &&
    allows(device.id, 'settings')
  )
}

/** What this device is told about its own access so clients can hide actions the server would refuse. Advisory only. */
export const accessOf = (device: DeviceInfo | undefined): 'owner' | 'viewer' =>
  device?.role === 'viewer' ? 'viewer' : 'owner'

/** HTTP authentication shared by production and route tests. No cookies or implicit browser origins. */
export class RemoteAccess {
  private failures = new Map<string, { count: number; until: number; updatedAt: number }>()
  constructor(
    private options: {
      devices: DeviceStore
      browserOrigins: string[]
      /** The host's durable id, proved to a paired device on request. */
      hostId?: string
      /** This host's own addresses, named in the identity answer so a paired device can find it when its address changes. */
      routes?: () => string[]
      /** Pairing by request from a nearby device. Absent: those endpoints do not exist and devices type a code. */
      pairing?: PairingRequests
      /** A device paired with a typed code, so the host can stop advertising itself for pairing. */
      paired?: () => void
      /**
       * Where a request came from; defaults to its socket's address, not tunneled. Behind a tunnel, the visitor's (see
       * `clientAddress`).
       */
      peer?: (req: IncomingMessage) => { address: string; tunneled: boolean }
      now?: () => number
    },
  ) {}

  /** Whether a connection that proved itself when it opened still belongs to a paired device. */
  authorized(header: string | undefined): boolean {
    return this.options.devices.authenticate(header, this.options.now?.() ?? Date.now(), 'proven') !== null
  }

  /** undefined means this response has already been sent. */
  async accept(req: IncomingMessage, res: ServerResponse): Promise<DeviceInfo | undefined> {
    const origin = req.headers.origin
    if (origin) {
      if (!this.options.browserOrigins.includes(origin)) {
        res.writeHead(403).end()
        return
      }
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Ramu-Protocol, X-Ramu-Proof')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(origin ? 204 : 403).end()
      return
    }
    const path = (req.url ?? '/').split('?')[0]
    if (path === '/health' && req.method === 'GET') {
      res
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION }))
      return
    }
    const now = this.options.now?.() ?? Date.now()
    // Bound attacker-controlled keys, and forget inactive peers so a past failure is not a permanent penalty.
    for (const [peer, state] of this.failures) if (now - state.updatedAt > 15 * 60_000) this.failures.delete(peer)
    const from = this.options.peer?.(req) ?? { address: req.socket.remoteAddress ?? 'unknown', tunneled: false }
    const peer = from.address
    const limit = this.failures.get(peer)
    if (limit && limit.until > now) {
      res.writeHead(429, { 'Retry-After': String(Math.ceil((limit.until - now) / 1000)) }).end()
      return
    }
    const rejected = (message?: string) => {
      const count = Math.min(20, (limit?.count ?? 0) + 1)
      if (this.failures.size >= 4096 && !this.failures.has(peer))
        this.failures.delete(this.failures.keys().next().value!)
      this.failures.set(peer, {
        count,
        until: count >= 5 ? now + Math.min(60_000, 1000 * 2 ** (count - 5)) : 0,
        updatedAt: now,
      })
      res
        .writeHead(401, { 'Content-Type': 'application/json' })
        .end(message ? JSON.stringify({ error: message }) : undefined)
    }
    if (path === IDENTITY_PATH && req.method === 'GET' && this.options.hostId) {
      const query = new URL(req.url ?? '/', 'http://host').searchParams
      const deviceId = query.get('device') ?? ''
      const challenge = query.get('challenge') ?? ''
      const [key, ...others] = CHALLENGE_PATTERN.test(challenge) ? this.options.devices.presenceKeys(deviceId) : []
      if (!key) {
        rejected()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(
        JSON.stringify({
          hostId: this.options.hostId,
          proof: hostProof(key, this.options.hostId, challenge),
          // The same proof for a renewed token the device may not have used yet; a client that holds that token checks it.
          ...(others.length
            ? { alternates: others.map((other) => hostProof(other, this.options.hostId!, challenge)) }
            : {}),
          routes: this.options.routes?.() ?? [],
        }),
      )
      return
    }
    const pairing = this.options.pairing
    if (
      pairing &&
      req.method === 'POST' &&
      path &&
      [PAIR_REQUEST_PATH, PAIR_REVEAL_PATH, PAIR_WAIT_PATH].includes(path)
    ) {
      // Pairing by request is for a nearby device. Through a public address anyone on the internet could put a request
      // in front of the person, so a device out there types a code or asks through the Ramu account instead.
      if (from.tunneled) {
        rejected('Pairing requests are accepted only from nearby devices. Enter a pairing code instead.')
        return
      }
      const body = await readJson(req)
      if (body === undefined) {
        rejected('Invalid pairing request')
        return
      }
      const reply = (value: unknown) =>
        res
          .writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          .end(JSON.stringify(value))
      try {
        if (path === PAIR_REQUEST_PATH) reply(pairing.begin(peer, body))
        else if (path === PAIR_REVEAL_PATH) {
          pairing.reveal(peer, body)
          reply({ ok: true })
        } else {
          const closed = new AbortController()
          res.once('close', () => closed.abort())
          reply(await pairing.wait(peer, body, closed.signal))
        }
      } catch (error) {
        const status = error instanceof PairingError ? error.status : 400
        const message = error instanceof Error ? error.message : 'Invalid pairing request'
        // Refusals count toward the same back-off as wrong codes, so nobody can probe or flood the host.
        if (status === 401 || status === 403 || status === 400) rejected(message)
        else res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: message }))
      }
      return
    }
    if (path === PAIR_PATH && req.method === 'POST') {
      let bytes = 0
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        bytes += chunk.length
        if (bytes > 4096) {
          res.writeHead(413).end()
          return
        }
        chunks.push(chunk)
      }
      let request: { code?: unknown; name?: unknown; kind?: unknown }
      try {
        request = JSON.parse(Buffer.concat(chunks).toString() || '{}') ?? {}
      } catch {
        rejected('Invalid pairing request')
        return
      }
      const paired =
        typeof request.code === 'string'
          ? this.options.devices.redeem(
              request.code,
              typeof request.name === 'string' ? request.name : undefined,
              now,
              request.kind === 'host' ? 'host' : undefined,
            )
          : null
      if (!paired) {
        rejected('That pairing code is wrong, already used or expired')
        return
      }
      this.failures.delete(peer)
      this.options.paired?.()
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(
        JSON.stringify({
          deviceId: paired.device.id,
          token: paired.token,
          ...(this.options.hostId ? { hostId: this.options.hostId } : {}),
          role: paired.device.role,
          expiresAt: paired.device.expiresAt,
        }),
      )
      return
    }
    const proofHeader = typeof req.headers[PROOF_HEADER] === 'string' ? req.headers[PROOF_HEADER] : undefined
    // A right token with a wrong proof says why, so a device whose clock is off corrects for it instead of giving up.
    const refused = () => {
      const reason = this.options.devices.lastProofRefusal
      rejected(reason ? `proof-${reason}` : undefined)
    }
    if (path === RENEW_PATH && req.method === 'POST') {
      // The body is optional: a device that binds its token to a key names the key there.
      const body = (await readJson(req)) as { key?: unknown } | undefined
      const renewed = this.options.devices.renew(req.headers.authorization, now, {
        key: body?.key,
        proof: proofHeader,
      })
      if (!renewed) {
        refused()
        return
      }
      this.failures.delete(peer)
      res
        .writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify(renewed))
      return
    }
    const device = this.options.devices.authenticate(req.headers.authorization, now, {
      header: proofHeader,
      purpose: path === SOCKET_PATH ? 'socket' : 'request',
    })
    if (!device) {
      refused()
      return
    }
    this.failures.delete(peer)
    res.setHeader('X-Ramu-Device-Role', device.role)
    if (device.expiresAt !== null) res.setHeader('X-Ramu-Token-Expires', String(device.expiresAt))
    return device
  }
}

/** A small JSON body, or undefined when it is too large or not JSON. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > 4096) return undefined
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}') ?? {}
  } catch {
    return undefined
  }
}
