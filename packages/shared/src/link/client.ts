// A device's side of Ramu Link: one relay WebSocket per stream, sealed end to end, carrying either one HTTP exchange or
// one Ramu socket. Platform-neutral: the desktop and the phone pass their own WebSocket and secure random source.
import { initiateLink, type SecureChannel } from './channel'
import type { RandomBytes } from './noise'
import {
  LINK_CLOSE,
  LINK_PATHS,
  LINK_PROTOCOL,
  bearerProtocol,
  linkHostOf,
  type LinkRequest,
  type LinkResponse,
} from './protocol'

interface BrowserSocket {
  binaryType: string
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: { code: number; reason: string }) => void) | null
  onerror: (() => void) | null
  send(data: ArrayBufferLike | Uint8Array): void
  close(code?: number, reason?: string): void
}
export type WebSocketConstructor = new (url: string, protocols?: string | string[]) => unknown

/** The account a device is signed in to, or null when it is not. */
export interface LinkAccount {
  service: string
  token: string
}
export interface LinkClientOptions {
  account(): LinkAccount | null | Promise<LinkAccount | null>
  /** The host key saved when this device paired; null before pairing, when only pairing by request is safe. */
  pinned(hostId: string): string | null | undefined
  random: RandomBytes
  WebSocket?: WebSocketConstructor
}

/** Why a stream ended, in terms a person can act on. */
export class LinkError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message)
  }
}
const closeMessage = (code: number) =>
  code === LINK_CLOSE.hostOffline
    ? 'This host is not connected to Ramu Link. Check that it is on and Link is turned on there.'
    : code === LINK_CLOSE.unauthorized
      ? 'Sign in to Ramu Link again.'
      : code === LINK_CLOSE.limit
        ? 'Too many connections to this host through Ramu Link.'
        : code === LINK_CLOSE.plan
          ? 'The Ramu Link plan of this host’s account does not cover new connections right now (relayed hours used up, or a host beyond its plan). Connect over the host’s own network, or get Plus in Settings → Remote access.'
          : 'The Ramu Link connection closed.'

const UNPINNED = 'Connect to this host once over Ramu Link or its network so this device learns its Link key.'

interface LinkStream {
  hostKey: string
  send(message: Uint8Array): void
  close(): void
  onmessage: (message: Uint8Array) => void
  onclose: (error: LinkError) => void
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const toBytes = (data: unknown): Uint8Array | null =>
  data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : null

/** Opens one sealed stream to `hostId`; resolves once the host has proved its key. */
export async function openLinkStream(
  options: LinkClientOptions,
  hostId: string,
  signal?: AbortSignal,
): Promise<LinkStream> {
  const account = await options.account()
  if (!account) throw new LinkError('Sign in to Ramu Link on this device first.', LINK_CLOSE.unauthorized)
  const Socket = (options.WebSocket ?? globalThis.WebSocket) as unknown as WebSocketConstructor | undefined
  if (!Socket) throw new LinkError('This device cannot open a Ramu Link connection.')
  const url = new URL(LINK_PATHS.relayConnect(hostId), account.service)
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:'
  const ws = new Socket(url.toString(), [LINK_PROTOCOL, bearerProtocol(account.token)]) as BrowserSocket
  ws.binaryType = 'arraybuffer'
  const handshake = initiateLink(hostId, options.random)
  return new Promise<LinkStream>((resolve, reject) => {
    let channel: SecureChannel | null = null
    let ended = false
    const stream: LinkStream = {
      hostKey: '',
      send(message) {
        if (!channel || ended) return
        for (const record of channel.seal(message)) ws.send(record)
      },
      close() {
        if (ended) return
        ended = true
        signal?.removeEventListener('abort', abort)
        ws.close(1000)
      },
      onmessage: () => {},
      onclose: () => {},
    }
    const fail = (error: LinkError) => {
      if (ended) return
      ended = true
      signal?.removeEventListener('abort', abort)
      ws.onmessage = ws.onclose = ws.onerror = null
      try {
        ws.close(1000)
      } catch {}
      if (channel) stream.onclose(error)
      else reject(error)
    }
    const abort = () => fail(new LinkError('Cancelled'))
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
    ws.onopen = () => ws.send(handshake.hello)
    ws.onmessage = (event) => {
      const bytes = toBytes(event.data)
      if (!bytes) return fail(new LinkError('Ramu Link sent an unexpected frame.'))
      try {
        if (!channel) {
          channel = handshake.finish(bytes, options.pinned(hostId))
          stream.hostKey = channel.hostKey
          resolve(stream)
          return
        }
        const message = channel.open(bytes)
        if (message) stream.onmessage(message)
      } catch (error) {
        fail(new LinkError(error instanceof Error ? error.message : 'Ramu Link stream failed'))
      }
    }
    ws.onerror = () => {}
    ws.onclose = (event) => fail(new LinkError(closeMessage(event.code), event.code))
  })
}

async function exchange(stream: LinkStream, request: LinkRequest): Promise<LinkResponse> {
  return new Promise((resolve, reject) => {
    stream.onmessage = (message) => {
      try {
        resolve(JSON.parse(decoder.decode(message)) as LinkResponse)
      } catch {
        reject(new LinkError('The host sent an invalid answer through Ramu Link.'))
      }
    }
    stream.onclose = reject
    stream.send(encoder.encode(JSON.stringify(request)))
  })
}

const headersOf = (init?: { headers?: unknown }): Record<string, string> => {
  const out: Record<string, string> = {}
  const source = init?.headers
  if (!source) return out
  if (typeof (source as Headers).forEach === 'function' && !Array.isArray(source))
    (source as Headers).forEach((value, key) => (out[key] = value))
  else if (Array.isArray(source)) for (const [key, value] of source as [string, string][]) out[key] = value
  else Object.assign(out, source)
  return out
}

/**
 * `fetch` for host origins: Link addresses go through a sealed stream, every other address to `fallback`. Only the
 * small JSON requests that happen outside the socket (pairing, renewal, identity, health) use it.
 */
export function linkFetch(options: LinkClientOptions, fallback: typeof fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const url = new URL(target)
    const hostId = linkHostOf(url.origin)
    if (!hostId) return fallback(input, init)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'POST') throw new LinkError('Ramu Link carries only GET and POST requests.')
    if (init?.body !== undefined && init.body !== null && typeof init.body !== 'string')
      throw new LinkError('Ramu Link requests carry text bodies only.')
    const headers = headersOf(init)
    // A credential goes only to the key this device pinned when it paired; before that, only pairing and identity
    // checks (which carry none) may use an unpinned stream.
    if (!options.pinned(hostId) && Object.keys(headers).some((key) => key.toLowerCase() === 'authorization'))
      throw new LinkError(UNPINNED)
    const stream = await openLinkStream(options, hostId, init?.signal ?? undefined)
    try {
      const answer = await exchange(stream, {
        kind: 'http',
        method,
        path: `${url.pathname}${url.search}`,
        headers,
        ...(typeof init?.body === 'string' ? { body: init.body } : {}),
      })
      const empty = answer.status === 204 || answer.status === 304
      return new Response(empty ? null : (answer.body ?? ''), { status: answer.status, headers: answer.headers })
    } finally {
      stream.close()
    }
  }) as typeof fetch
}

type Handlers = {
  onopen(): void
  onmessage(text: string): void
  onclose(info: { status?: number; code?: string }): void
}
/**
 * A `SocketFactory` (see `@ramu/client-runtime/socket`) for Link addresses, wrapping `fallback` for every other one. The
 * Ramu socket's own frames, authentication and reconnects run unchanged on top.
 */
export function linkSocketFactory<S extends { send(text: string): void; close(): void }>(
  options: LinkClientOptions,
  fallback: (url: string, headers: Record<string, string>, handlers: Handlers) => S,
) {
  return (
    url: string,
    headers: Record<string, string>,
    handlers: Handlers,
  ): { send(text: string): void; close(): void } => {
    const parsed = new URL(url)
    const hostId = linkHostOf(`https://${parsed.host}`)
    if (!hostId) return fallback(url, headers, handlers)
    if (!options.pinned(hostId)) {
      queueMicrotask(() => handlers.onclose({ code: 'ELINKPIN' }))
      return { send() {}, close() {} }
    }
    const controller = new AbortController()
    let stream: LinkStream | null = null
    let open = false
    let closed = false
    const finish = (info: { status?: number; code?: string }) => {
      if (closed) return
      closed = true
      stream?.close()
      handlers.onclose(info)
    }
    void openLinkStream(options, hostId, controller.signal).then(
      (opened) => {
        if (closed) return opened.close()
        stream = opened
        opened.onclose = (error) =>
          finish(error.code === LINK_CLOSE.unauthorized ? { code: 'ELINKAUTH' } : { code: 'ECONNRESET' })
        opened.onmessage = (message) => {
          if (open) return handlers.onmessage(decoder.decode(message))
          let answer: LinkResponse
          try {
            answer = JSON.parse(decoder.decode(message)) as LinkResponse
          } catch {
            return finish({ code: 'EPROTO' })
          }
          if (answer.status !== 101) return finish({ status: answer.status })
          open = true
          handlers.onopen()
        }
        opened.send(
          encoder.encode(JSON.stringify({ kind: 'socket', path: `${parsed.pathname}${parsed.search}`, headers })),
        )
      },
      (error: unknown) =>
        finish(
          error instanceof LinkError && error.code === LINK_CLOSE.hostOffline
            ? { code: 'EHOSTDOWN' }
            : error instanceof LinkError && error.code === LINK_CLOSE.unauthorized
              ? { code: 'ELINKAUTH' }
              : { code: 'ECONNREFUSED' },
        ),
    )
    return {
      send(text) {
        if (open && stream) stream.send(encoder.encode(text))
      },
      close() {
        controller.abort()
        finish({})
      },
    }
  }
}
