// Wire formats shared by the Ramu Link service, the host and its clients. The relay only ever sees the outer frames
// here; everything a device and a host say to each other is sealed by `channel.ts`.
import { utf8ToBytes } from '@noble/hashes/utils'

/**
 * The hosted service, once one is deployed under a domain the project owns. Until then every host and client is pointed
 * at a deployment in Settings or with `RAMU_LINK_URL`; a guessed default could be registered by someone else.
 */
export const DEFAULT_LINK_SERVICE: string | null = null
/** A service URL must be HTTPS; plain HTTP only on this computer, for running the Worker locally. */
export function linkServiceUrl(input: string): string {
  const url = new URL(input.trim())
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password)
    throw new Error('Enter the HTTPS address of a Ramu Link service')
  return url.origin
}
/** WebSocket subprotocol both relay endpoints answer with. */
export const LINK_PROTOCOL = 'ramu-link.v1'

/**
 * What each plan on a service that sells Plus allows. Phones and browsers never count; only relayed time does, and only
 * while the relay is awake carrying a stream. A service that sells nothing grants Plus with its own host limit.
 */
export const LINK_PLANS = {
  free: { hosts: 3, relayedHours: 60 },
  plus: { hosts: 20, relayedHours: null },
} as const satisfies Record<string, { hosts: number; relayedHours: number | null }>
export type LinkPlan = keyof typeof LINK_PLANS
export type LinkBillingInterval = 'year' | 'month'

/** An account's plan and this month's use, as `GET /v1/me` reports it. */
export interface LinkPlanStatus {
  plan: LinkPlan
  /** Where Plus comes from: a payment, or a service that sells nothing. */
  source: 'free' | 'paddle' | 'self-hosted'
  /** When Plus ends without a renewal; null while it renews or never ends. */
  expiresAt: number | null
  /** A cancelled subscription keeps Plus until `expiresAt`. */
  renews: boolean
  hosts: number
  hostLimit: number | null
  /** `YYYY-MM`, UTC; the count starts again on the first of the month. */
  month: string
  relayedSeconds: number
  relayedLimitSeconds: number | null
  /** The service sells Plus, so **Get Plus** has somewhere to go. */
  checkout: boolean
}

export const LINK_PATHS = {
  hosts: '/v1/hosts',
  host: (hostId: string) => `/v1/hosts/${hostId}`,
  shares: (hostId: string) => `/v1/hosts/${hostId}/shares`,
  share: (hostId: string, userId: string) => `/v1/hosts/${hostId}/shares/${encodeURIComponent(userId)}`,
  me: '/v1/me',
  usage: '/v1/usage',
  checkout: '/v1/checkout',
  relayHost: '/v1/relay/host',
  relayConnect: (hostId: string) => `/v1/relay/connect/${hostId}`,
  /** Public: a webhook sender posts here; `path` is the host's own (`/hooks/<token>`). */
  hook: (hostId: string, path: string) => `/h/${hostId}${path}`,
} as const

export const HOST_ID = /^[0-9a-f]{32}$/
export const isHostId = (value: unknown): value is string => typeof value === 'string' && HOST_ID.test(value)

/**
 * A host reached through Link is addressed as an origin under `.invalid` (RFC 2606), so every place that stores, compares
 * or joins host origins keeps working, and a request that skipped the Link transport fails to resolve instead of leaking.
 */
const LINK_SUFFIX = '.link.invalid'
export const linkAddress = (hostId: string) => `https://${hostId}${LINK_SUFFIX}`
export function linkHostOf(address: string): string | null {
  try {
    const { hostname, protocol } = new URL(address)
    if (protocol !== 'https:' || !hostname.endsWith(LINK_SUFFIX)) return null
    const hostId = hostname.slice(0, -LINK_SUFFIX.length)
    return isHostId(hostId) ? hostId : null
  } catch {
    return null
  }
}
export const isLinkAddress = (address: string) => linkHostOf(address) !== null

/** Prologue every handshake mixes in, so a stream for one host can never complete with another. */
export const linkPrologue = (hostId: string) => utf8ToBytes(`ramu-link/1 ${hostId}`)

/** Credentials ride in the subprotocol list: headers are not available to every WebSocket, and URLs end up in logs. */
const base64url = (text: string) => {
  const bytes = utf8ToBytes(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromBase64url = (text: string) => {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}
export const bearerProtocol = (token: string) => `bearer.${base64url(token)}`
export const hostProtocol = (secret: string) => `host.${base64url(secret)}`
/** The credential a client offered, or null. Only `bearer.` and `host.` entries are read. */
export function credentialFromProtocols(header: string | null, kind: 'bearer' | 'host'): string | null {
  for (const entry of (header ?? '').split(',').map((part) => part.trim())) {
    if (!entry.startsWith(`${kind}.`)) continue
    try {
      const value = fromBase64url(entry.slice(kind.length + 1))
      return value.length > 0 && value.length <= 4096 ? value : null
    } catch {
      return null
    }
  }
  return null
}

/** Close codes the relay uses for a device stream. */
export const LINK_CLOSE = {
  hostOffline: 4404,
  unauthorized: 4401,
  /** The account's plan does not cover this stream (relayed hours used up, or a host beyond the plan's limit). */
  plan: 4402,
  limit: 4429,
  hostClosed: 4000,
} as const

/**
 * Frames between the relay and a host: `[type u8][stream u32][payload]`. `hook` carries one sealed webhook request
 * (`link/hooks.ts`) on stream 0, outside any device stream; a host that predates it ignores the frame.
 */
export const MUX = { open: 1, data: 2, close: 3, hook: 4 } as const
export type MuxType = (typeof MUX)[keyof typeof MUX]
export const MAX_STREAMS_PER_HOST = 64
/** Kept well under every platform's WebSocket message limit; records are fragmented to fit. */
export const MAX_FRAME_BYTES = 64 * 1024

export function encodeMux(type: MuxType, stream: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const frame = new Uint8Array(5 + payload.length)
  frame[0] = type
  new DataView(frame.buffer).setUint32(1, stream >>> 0)
  frame.set(payload, 5)
  return frame
}
export function decodeMux(frame: Uint8Array): { type: MuxType; stream: number; payload: Uint8Array } | null {
  if (frame.length < 5) return null
  const type = frame[0]
  if (type !== MUX.open && type !== MUX.data && type !== MUX.close && type !== MUX.hook) return null
  const stream = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(1)
  return { type, stream, payload: frame.subarray(5) }
}

/** What the relay tells the host about a new stream; the account is the relay's claim, never proof of a device. */
export interface StreamOpen {
  account: string
  /** The account was given this host by its owner rather than owning it; the host lets it pair only as a viewer. */
  shared?: boolean
}

/** The first sealed message a device sends on a stream. */
export type LinkRequest =
  | { kind: 'http'; method: 'GET' | 'POST'; path: string; headers: Record<string, string>; body?: string }
  | { kind: 'socket'; path: string; headers: Record<string, string> }
/** The host's answer: for a socket, 101 means every later message is one socket text frame. */
export interface LinkResponse {
  status: number
  headers: Record<string, string>
  body?: string
}
