// Wire contract between a Ramu workspace server and any client (desktop, web, mobile, relay).
// The method table and push events live in @ramu/shared/api; this file covers the transport around them.

/** Bumped when requests, events or authentication change incompatibly. */
export const PROTOCOL_VERSION = 1

/** Features a server advertises so independently updated clients can adapt. */
export const CAPABILITIES = {
  /** Calls `{ method, args }` answered with a value or an error, over the WebSocket. */
  invoke: 'invoke',
  /** Sequenced snapshots, terminal recovery and remote folder browsing. */
  mobileCompanion: 'mobile-companion',
  liveActivities: 'mobile-live-activities',
  /** Host-owned browser readiness, explicit per-device/thread grants and bounded authenticated viewing. */
  hostBrowser: 'host-browser',
  /** Events carrying `{ channel, payload }`, over the WebSocket. */
  events: 'events',
  /** The server can ask a local client to run native dialogs (folder picker, reveal in Finder). */
  hostRequests: 'host-requests',
  /** The server also accepts bearer-authenticated TCP connections. */
  remote: 'remote',
  /** POST /pair trades a one-time code for a per-device token that can be revoked on its own. */
  pairing: 'pairing',
  /** POST /renew rotates this device's token with a bounded overlap. */
  renewal: 'renewal',
  /** A call accepts an `operationKey` so a mutation retried after a lost reply runs once. */
  operationKeys: 'operation-keys',
  /** GET /socket upgrades to the one WebSocket that carries every call and event; there is no HTTP or SSE equivalent. */
  webSocket: 'websocket',
} as const
export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES]

/** Where a client reaches a workspace server. */
export type RuntimeEndpoint = { kind: 'socket'; path: string } | { kind: 'http'; url: string; token: string }

export const AUTH_SCHEME = 'Bearer'
/** GET /identity?device=<id>&challenge=<nonce>: the host proves it knows this device's key, without any credential being sent. */
export const IDENTITY_PATH = '/identity'
export const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
export interface HostIdentityResponse {
  hostId: string
  proof: string
}
export const PAIR_PATH = '/pair'
/** POST /renew (authenticated with the current device token) swaps it for a fresh one; see `DeviceStore.renew`. */
export const RENEW_PATH = '/renew'
export interface RenewResponse {
  token: string
  expiresAt: number | null
  /** The new token is bound to this device's key: the host will ask for a proof with it. Absent from older hosts. */
  bound?: boolean
}

/** Body of `POST /pair`. The code comes from `ramu pair` on the server's computer; it works once and expires. */
export interface PairRequest {
  code: string
  name?: string
  /** `host`: another Ramu host whose agents start threads here, limited to that. Absent for phones and desktops. */
  kind?: 'host'
}
export interface PairResponse {
  deviceId: string
  token: string
  /** The host's durable identifier, bound at this explicit pairing and checked later through IDENTITY_PATH. */
  hostId?: string
  /** When the token stops working unless renewed; null never. */
  expiresAt: number | null
}
export const PROTOCOL_HEADER = 'x-ramu-protocol'
export const MAX_REQUEST_BYTES = 16_000_000

export interface InvokeRequest {
  method: string
  args: unknown[]
  /** Identifies one logical mutation across retries; the server binds it to the method, arguments and device. */
  operationKey?: string
}

export const OPERATION_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

/** Mutations whose reply can be lost after the host already ran them: a retry must carry an operation key. */
export const RECOVERABLE_MUTATIONS: ReadonlySet<string> = new Set([
  'tasks.create',
  'thread.start',
  'agent.start',
  'agent.send',
  'agent.submit',
  'agent.sendQueuedNow',
])

/**
 * Sent on the upgrade by a client that can have missed events replayed: `new` on its first connection, then the
 * `resume` id the host gave it and the number of the last event it received, as `id:n`.
 */
export const RESUME_HEADER = 'x-ramu-resume'

/** Path of the WebSocket upgrade. Credentials travel in the upgrade's Authorization header, never in the URL. */
export const SOCKET_PATH = '/socket'

/**
 * Frames on the socket. `id` correlates one request with its answer and is unrelated to an `operationKey`, which
 * identifies a logical mutation across retries. Events carry `{ channel, payload }`.
 */
export type SocketClientFrame =
  | { t: 'invoke'; id: number; method: string; args: unknown[]; operationKey?: string }
  /** `flow` asks the host to hold back terminal output the client has not acknowledged (see `ack`). */
  | {
      t: 'subscribe'
      id: number
      channels: string[]
      keys?: Record<string, string[]>
      /**
       * For a keyed channel, event kinds to leave out for resources not named in `keys`: a client that follows every
       * thread's state but streams the transcript of only the threads it shows. Resources in `keys` arrive in full.
       */
      skip?: Record<string, string[]>
      flow?: boolean
      /** Every channel, whatever `channels` lists. */
      everything?: boolean
    }
  /** Output of terminal `id` the client has processed, in the characters of its `term:data` chunks. */
  | { t: 'ack'; id: string; bytes: number }
  | { t: 'ping' }

/** Payload field that names the resource of a high-volume channel, so a client can ask for only the threads and terminals it shows. */
export const SOCKET_EVENT_KEYS: Readonly<Record<string, 'sessionId' | 'id'>> = {
  'agent:event': 'sessionId',
  'agent:rewound': 'sessionId',
  'context:changed': 'sessionId',
  'aside:changed': 'sessionId',
  'term:data': 'id',
  'term:exit': 'id',
  'term:behind': 'id',
}

/** Terminal output one connection may have sent and unacknowledged before the host holds back further chunks. */
export const TERMINAL_FLOW_WINDOW = 1_000_000
export const MAX_SUBSCRIBED_CHANNELS = 64
export const MAX_SUBSCRIBED_KEYS = 200
export const MAX_SUBSCRIBED_SKIPPED_KINDS = 64
export type SocketServerFrame =
  /** `resume` names this connection's place on the event stream; `resumed` says a returning client was sent what it missed. */
  | { t: 'ready'; epoch: string; resume?: string; resumed?: boolean }
  | { t: 'result'; id: number; value: unknown }
  | { t: 'error'; id: number; error: string; status?: number }
  /** `n` numbers the events a client may ask to have replayed after a short loss of its connection. */
  | { t: 'event'; channel: string; payload: unknown; n?: number }
  | { t: 'pong' }
  /** Events were held back while this client was behind (it asked with `catchup=1`): fetch current state again. */
  | { t: 'resync' }

const UNDEFINED_MARKER = '$ramuUndefined'

/** JSON drops `undefined`; the marker keeps optional arguments in their positions. */
export function encodeInvoke(method: string, args: unknown[] = [], operationKey?: string): string {
  return JSON.stringify({ method, args, ...(operationKey ? { operationKey } : {}) }, (_key, value) =>
    value === undefined ? { [UNDEFINED_MARKER]: true } : value,
  )
}

export function decodeInvoke(text: string): InvokeRequest {
  return JSON.parse(text || '{}', (_key, value) =>
    value && typeof value === 'object' && Object.keys(value).length === 1 && value[UNDEFINED_MARKER] === true
      ? undefined
      : value,
  )
}

/** Accepts "host:port" or a full URL and returns a normalized base URL. */
export function parseRemoteUrl(input: string): string {
  const text = input.trim()
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Remote servers use http:// or https://')
  return url.origin
}

export function isLoopbackHost(host: string): boolean {
  const value = host.replace(/^\[|\]$/g, '').toLowerCase()
  return value === 'localhost' || value === '::1' || /^127\.\d+\.\d+\.\d+$/.test(value)
}

/** What a person can paste to add a computer: a pairing link (getramu.dev or `ramu://pair`), an https link with a code, or an address. */
export interface PairInput {
  url: string
  code?: string
  expiresAt?: number
  name?: string
  /** Other addresses of the same host to try when `url` cannot be reached, in order. Only https ones are kept. */
  alternates?: string[]
}

/** What a pairing link carries. */
export interface PairOffer {
  url: string
  code: string
  expiresAt?: number
  name?: string
  alternates?: string[]
}

/** The most backup addresses a link carries. A host has one tunnel at a time; the rest is headroom. */
const MAX_ALTERNATES = 3

const pairParams = (offer: PairOffer) => {
  const params = new URLSearchParams({ url: offer.url, code: offer.code })
  if (offer.expiresAt) params.set('exp', String(offer.expiresAt))
  if (offer.name) params.set('name', offer.name)
  // One comma-separated value: an origin never holds a comma, and a link opened from outside the app keeps one value
  // per name.
  const alternates = (offer.alternates ?? []).filter((url) => url !== offer.url).slice(0, MAX_ALTERNATES)
  if (alternates.length) params.set('alt', alternates.join(','))
  return params
}

/**
 * The backup addresses a link names: https only, since the code is sent to each one tried and only a certificate
 * proves an address is the host's own (a private address can be anyone's on another network). Bad entries are dropped.
 */
function alternatesFrom(value: string | null, primary: string): string[] {
  const found: string[] = []
  for (const entry of (value ?? '').split(',')) {
    try {
      const url = parseRemoteUrl(entry)
      if (url.startsWith('https://') && url !== primary && !found.includes(url)) found.push(url)
    } catch {
      /* not an address */
    }
    if (found.length === MAX_ALTERNATES) break
  }
  return found
}

/**
 * Pairs at the link's address, then at each backup in turn, moving on only when an address cannot be reached: an
 * answer, even a refused code, comes from the host and ends it there. Resolves with the address that worked.
 */
export async function pairAtFirstReachable<T>(
  urls: readonly string[],
  attempt: (url: string) => Promise<T>,
  unreachable: (error: unknown) => boolean,
): Promise<{ url: string; result: T }> {
  let failure: unknown = new Error('Enter the address')
  for (const url of urls) {
    try {
      return { url, result: await attempt(url) }
    } catch (error) {
      failure = error
      if (!unreachable(error)) break
    }
  }
  throw failure
}

/** `ramu://pair?url=<origin>&code=<code>&exp=<ms>`. Like the QR payload it carries no device token. */
export function encodePairLink(offer: PairOffer): string {
  return `ramu://pair?${pairParams(offer)}`
}

/** The page a pairing QR opens when a phone's own camera reads it: it opens the app, or its store page first. */
export const PAIR_PAGE = 'https://getramu.dev/pair'

/**
 * A pairing QR any camera can read: getramu.dev/pair with the offer after `#`, which a browser never sends to the site,
 * so the host's address and code stay between the two devices. The app reads the same link when it scans it.
 */
export function encodePairWebLink(offer: PairOffer): string {
  return `${PAIR_PAGE}#${pairParams(offer)}`
}

const PAIR_CODE = /^[A-Z2-9]{5}-?[A-Z2-9]{5}$/

function offerFromParams(params: URLSearchParams, now: number): PairInput {
  const url = params.get('url'),
    code = (params.get('code') ?? '').trim().toUpperCase()
  if (!url) throw new Error('This pairing link has no address')
  if (code && !PAIR_CODE.test(code)) throw new Error('This pairing link has an invalid code')
  const expiresAt = Number(params.get('exp')) || undefined
  if (expiresAt && expiresAt <= now) throw new Error('This pairing link has expired. Create a new one on the host.')
  const primary = parseRemoteUrl(url)
  const alternates = alternatesFrom(params.get('alt'), primary)
  return {
    url: primary,
    ...(code ? { code } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(params.get('name') ? { name: params.get('name')!.slice(0, 60) } : {}),
    ...(alternates.length ? { alternates } : {}),
  }
}

export function parsePairInput(input: string, now = Date.now()): PairInput {
  const text = input.trim()
  if (!text || text.length > 4096) throw new Error('Paste a Ramu pairing link or an address')
  let link: URL | null = null
  try {
    link = new URL(text)
  } catch {
    /* a bare address such as 100.64.0.7:7788 */
  }
  if (link?.protocol === 'ramu:') {
    if (link.hostname !== 'pair' && link.pathname.replace(/^\/+/, '') !== 'pair')
      throw new Error('This is not a Ramu pairing link')
    return offerFromParams(link.searchParams, now)
  }
  if (link && `${link.origin}${link.pathname.replace(/\/$/, '')}` === PAIR_PAGE)
    return offerFromParams(new URLSearchParams(link.hash.slice(1)), now)
  if (link && (link.protocol === 'http:' || link.protocol === 'https:')) {
    // A remote link may carry the code as ?code= or #code, which is not sent to the server.
    const code = (link.searchParams.get('code') ?? link.hash.replace(/^#(code=)?/, '')).trim().toUpperCase()
    if (code && !PAIR_CODE.test(code)) throw new Error('This link has an invalid pairing code')
    return { url: link.origin, ...(code ? { code } : {}) }
  }
  return { url: parseRemoteUrl(text) }
}

/** `user@host`, `host` or an alias from ~/.ssh/config, never something ssh could read as an option. */
export function parseSshTarget(input: string): string {
  const text = input
    .trim()
    .replace(/^ssh:\/\//i, '')
    .replace(/\/$/, '')
  if (!/^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9._:[\]-]+$/.test(text) || text.startsWith('-') || text.length > 255)
    throw new Error('Enter user@host or an alias from your SSH config')
  return text
}

const mark = (_key: string, value: unknown) => (value === undefined ? { [UNDEFINED_MARKER]: true } : value)
const unmark = (_key: string, value: any) =>
  value && typeof value === 'object' && Object.keys(value).length === 1 && value[UNDEFINED_MARKER] === true
    ? undefined
    : value

export const encodeSocketFrame = (frame: SocketClientFrame | SocketServerFrame): string => JSON.stringify(frame, mark)

/** Parses one frame, or returns null for anything that is not a well-formed frame of the expected direction. */
export function decodeSocketFrame(text: string, from: 'client'): SocketClientFrame | null
export function decodeSocketFrame(text: string, from: 'server'): SocketServerFrame | null
export function decodeSocketFrame(
  text: string,
  from: 'client' | 'server',
): SocketClientFrame | SocketServerFrame | null {
  let frame: any
  try {
    frame = JSON.parse(text, unmark)
  } catch {
    return null
  }
  if (!frame || typeof frame !== 'object' || typeof frame.t !== 'string') return null
  const int = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  if (from === 'client') {
    if (frame.t === 'ping') return { t: 'ping' }
    if (
      frame.t === 'ack' &&
      typeof frame.id === 'string' &&
      frame.id.length > 0 &&
      frame.id.length <= 128 &&
      int(frame.bytes)
    )
      return { t: 'ack', id: frame.id, bytes: frame.bytes }
    if (
      frame.t === 'invoke' &&
      int(frame.id) &&
      typeof frame.method === 'string' &&
      frame.method.length <= 200 &&
      Array.isArray(frame.args) &&
      (frame.operationKey === undefined ||
        (typeof frame.operationKey === 'string' && OPERATION_KEY_PATTERN.test(frame.operationKey)))
    )
      return frame
    if (
      frame.t === 'subscribe' &&
      int(frame.id) &&
      Array.isArray(frame.channels) &&
      frame.channels.length <= MAX_SUBSCRIBED_CHANNELS &&
      frame.channels.every((c: unknown) => typeof c === 'string' && c.length > 0 && c.length <= 64) &&
      (frame.flow === undefined || typeof frame.flow === 'boolean') &&
      (frame.everything === undefined || typeof frame.everything === 'boolean') &&
      (frame.skip === undefined ||
        (frame.skip &&
          typeof frame.skip === 'object' &&
          !Array.isArray(frame.skip) &&
          Object.keys(frame.skip).length <= MAX_SUBSCRIBED_CHANNELS &&
          Object.values(frame.skip).every(
            (list) =>
              Array.isArray(list) &&
              list.length <= MAX_SUBSCRIBED_SKIPPED_KINDS &&
              list.every((k) => typeof k === 'string' && k.length > 0 && k.length <= 64),
          ))) &&
      (frame.keys === undefined ||
        (frame.keys &&
          typeof frame.keys === 'object' &&
          !Array.isArray(frame.keys) &&
          Object.values(frame.keys).every(
            (list) =>
              Array.isArray(list) &&
              list.length <= MAX_SUBSCRIBED_KEYS &&
              list.every((k) => typeof k === 'string' && k.length <= 128),
          )))
    )
      return frame
    return null
  }
  if (frame.t === 'pong' || frame.t === 'resync') return frame
  if (frame.t === 'ready' && typeof frame.epoch === 'string') return frame
  if (frame.t === 'result' && int(frame.id)) return frame
  if (frame.t === 'error' && int(frame.id) && typeof frame.error === 'string') return frame
  if (frame.t === 'event' && typeof frame.channel === 'string') return frame
  return null
}
