import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { connect, isIP, type Socket } from 'node:net'

/** How long a forward stays open without the viewer closing it. */
export const PHONE_FORWARD_TTL = 30 * 60_000
/** Forwards one device may hold at once; opening another closes its oldest. */
const PER_DEVICE = 3
/** The one-time address the phone's viewer opens first; it trades the token for the forward's cookie. */
export const PHONE_FORWARD_OPEN_PATH = '/__ramu/open'

// 0.0.0.0 is a server listening on every address, loopback included.
const LOOPBACK_NAME = /^(localhost|.+\.localhost|127(\.\d+){3}|0\.0\.0\.0|\[::1\])$/

/** `::ffff:192.168.1.5` and `192.168.1.5` are one peer. */
const plainAddress = (address: string | undefined) => (address ?? '').replace(/^::ffff:(?=\d+\.)/, '').toLowerCase()
const isLoopbackAddress = (address: string) => /^127\./.test(address) || address === '::1'

export interface PhoneForwardTarget {
  /** The loopback port the dev server listens on. */
  port: number
  /** The path the viewer lands on after the cookie is set. */
  path: string
}

/**
 * The page a phone's viewer can forward: an http address on this host's loopback, with no credentials. Anything else
 * already opens on the phone directly or is not a dev server.
 */
export function phoneForwardTarget(value: string, refusedPorts: readonly number[] = []): PhoneForwardTarget {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('This page has no address the phone can open.')
  }
  if (url.protocol !== 'http:' || url.username || url.password || !LOOPBACK_NAME.test(url.hostname.toLowerCase()))
    throw new Error('Only an http page on the host’s localhost is forwarded to the phone.')
  const port = Number(url.port || 80)
  if (refusedPorts.includes(port)) throw new Error('Ramu’s own port is not forwarded.')
  return { port, path: `${url.pathname}${url.search}` }
}

/**
 * The phone's address and the local address its connection arrived on, when a forward can reach it there. A
 * connection through a tunnel (Ramu's public address, or the phone's own SSH tunnel arriving on loopback) has no
 * address on this network to open a port for.
 */
export function phoneForwardPeer(
  remote: string | undefined,
  local: string | undefined,
  tunneled: boolean,
): { phone: string; bind: string } {
  const phone = plainAddress(remote)
  const bind = plainAddress(local)
  if (tunneled || !isIP(phone) || !isIP(bind) || isLoopbackAddress(phone) || isLoopbackAddress(bind))
    throw new Error(
      'This phone reaches the host through a tunnel, so a forward could not reach it. Start the dev server on all addresses, or open the page in the host browser.',
    )
  return { phone, bind }
}

export interface PhoneForwardOpen {
  deviceId: string
  /** The phone's address as this host saw its connection; the only peer the forward answers. */
  phone: string
  /** The local address the phone's connection arrived on, which the phone already reaches. */
  bind: string
  target: PhoneForwardTarget
}

export interface PhoneForward {
  id: string
  /** The forward's own port on `bind`. */
  port: number
  /** The dev server's loopback port, shown in the viewer. */
  targetPort: number
  /** Path and query the phone opens on the forward's port; it carries the one-time token. */
  openPath: string
  expiresAt: number
}

interface Entry {
  id: string
  deviceId: string
  server: Server
  sockets: Set<Socket>
  timer: ReturnType<typeof setTimeout>
  createdAt: number
}

/**
 * Forwards that let one phone open a dev server listening only on this host's loopback. Each is its own listener on
 * a fresh port of the address the phone already reaches the host at. It answers only that phone's address, and only
 * requests carrying the cookie set when the phone redeems the one-time token in its open address. It closes when the
 * viewer closes it, after 30 minutes, or when the device is revoked.
 */
export class PhoneForwards {
  private entries = new Map<string, Entry>()

  constructor(
    private options: {
      ttl?: number
      now?: () => number
      /** Where loopback lives; tests point it elsewhere. */
      loopback?: string
    } = {},
  ) {}

  async open({ deviceId, phone, bind, target }: PhoneForwardOpen): Promise<PhoneForward> {
    const peer = plainAddress(phone)
    const local = plainAddress(bind)
    if (!isIP(peer) || !isIP(local)) throw new Error('This phone’s connection has no address to forward to.')
    const mine = [...this.entries.values()].filter((entry) => entry.deviceId === deviceId)
    for (const entry of mine
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, Math.max(0, mine.length - PER_DEVICE + 1)))
      this.closeEntry(entry)

    const id = randomUUID()
    const token = randomBytes(24).toString('base64url')
    const secret = randomBytes(32).toString('base64url')
    const cookie = `ramu_forward_${id.slice(0, 8)}`
    let redeemed = false
    const loopback = this.options.loopback ?? '127.0.0.1'
    const sockets = new Set<Socket>()

    const hasCookie = (req: IncomingMessage) => {
      const value = cookieValue(req.headers.cookie, cookie)
      return !!value && safeEqual(value, secret)
    }
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://forward')
      if (url.pathname === PHONE_FORWARD_OPEN_PATH) {
        if (redeemed || !safeEqual(url.searchParams.get('t') ?? '', token)) return refuse(res)
        redeemed = true
        res
          .writeHead(303, {
            'Set-Cookie': `${cookie}=${secret}; Path=/; HttpOnly; SameSite=Lax`,
            Location: target.path || '/',
            'Cache-Control': 'no-store',
          })
          .end()
        return
      }
      if (!hasCookie(req)) return refuse(res)
      const upstream = httpRequest(
        {
          host: loopback,
          port: target.port,
          method: req.method,
          path: req.url,
          headers: forwardedHeaders(req, cookie, target.port),
        },
        (answer) => {
          const headers = { ...answer.headers }
          // A redirect to the dev server's own localhost address stays on the forward.
          const location = typeof headers.location === 'string' ? headers.location : undefined
          if (location) headers.location = localRedirect(location, target.port) ?? location
          res.writeHead(answer.statusCode ?? 502, answer.statusMessage, headers)
          answer.pipe(res)
        },
      )
      upstream.on('error', () => {
        if (!res.headersSent)
          res
            .writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
            .end('The dev server on the host did not answer.')
        else res.destroy()
      })
      req.pipe(upstream)
    })
    // Hot reload and other sockets the page opens.
    server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
      if (!hasCookie(req)) return socket.destroy()
      const upstream = connect(target.port, loopback, () => {
        const headers = forwardedHeaders(req, cookie, target.port)
        const lines = [`${req.method} ${req.url} HTTP/1.1`]
        for (const [name, value] of Object.entries(headers))
          for (const entry of Array.isArray(value) ? value : [value])
            if (entry !== undefined) lines.push(`${name}: ${entry}`)
        upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
        if (head.length) upstream.write(head)
        socket.pipe(upstream).pipe(socket)
      })
      sockets.add(upstream)
      upstream.on('close', () => sockets.delete(upstream))
      // Either side ending ends both, so no half-open socket outlives the page.
      upstream.on('close', () => socket.destroy())
      socket.on('close', () => upstream.destroy())
      upstream.on('error', () => socket.destroy())
      socket.on('error', () => upstream.destroy())
    })
    // Every connection from another address is dropped before a byte is read.
    server.on('connection', (socket: Socket) => {
      if (plainAddress(socket.remoteAddress) !== peer) return socket.destroy()
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, local, () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const ttl = this.options.ttl ?? PHONE_FORWARD_TTL
    const now = this.options.now?.() ?? Date.now()
    const entry: Entry = {
      id,
      deviceId,
      server,
      sockets,
      createdAt: now,
      timer: setTimeout(() => this.closeEntry(entry), ttl),
    }
    entry.timer.unref?.()
    this.entries.set(id, entry)
    return {
      id,
      port,
      targetPort: target.port,
      openPath: `${PHONE_FORWARD_OPEN_PATH}?t=${token}`,
      expiresAt: now + ttl,
    }
  }

  /** Closes one forward; only the device that opened it can. */
  close(deviceId: string, id: string): void {
    const entry = this.entries.get(id)
    if (entry && entry.deviceId === deviceId) this.closeEntry(entry)
  }

  /** Closes every forward of devices no longer paired. */
  keepOnly(paired: (deviceId: string) => boolean): void {
    for (const entry of [...this.entries.values()]) if (!paired(entry.deviceId)) this.closeEntry(entry)
  }

  closeAll(): void {
    for (const entry of [...this.entries.values()]) this.closeEntry(entry)
  }

  get size(): number {
    return this.entries.size
  }

  private closeEntry(entry: Entry) {
    if (!this.entries.delete(entry.id)) return
    clearTimeout(entry.timer)
    entry.server.close()
    for (const socket of entry.sockets) socket.destroy()
  }
}

function refuse(res: ServerResponse) {
  res
    .writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    .end('Open this page again from the phone’s browser viewer in Ramu.')
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim()
  }
  return undefined
}

/**
 * The request as the dev server should see it: addressed to its own localhost port, so host checks (Vite's
 * `allowedHosts`, webpack's `allowedHosts`) pass, and without the forward's cookie, which is not the page's.
 */
function forwardedHeaders(req: IncomingMessage, cookie: string, port: number) {
  const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: `localhost:${port}` }
  const kept = (req.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(`${cookie}=`))
  if (kept.length) headers.cookie = kept.join('; ')
  else delete headers.cookie
  if (typeof headers.origin === 'string') headers.origin = `http://localhost:${port}`
  return headers
}

/** A redirect to the dev server's own loopback origin, made relative so it stays on the forward. */
function localRedirect(location: string, port: number): string | null {
  try {
    const url = new URL(location)
    if (!LOOPBACK_NAME.test(url.hostname.toLowerCase()) || Number(url.port || 80) !== port) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}
