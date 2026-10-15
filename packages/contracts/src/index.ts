// Wire contract between a Ramu workspace server and any client (desktop, web, mobile, relay).
// The method table and push events live in @ramu/shared/api; this file covers the transport around them.

/** Bumped when requests, events or authentication change incompatibly. */
export const PROTOCOL_VERSION = 1

/** Features a server advertises so independently updated clients can adapt. */
export const CAPABILITIES = {
  /** POST /invoke with { method, args }; the response is { value } or { error }. */
  invoke: 'invoke',
  /** Sequenced snapshots, terminal recovery and remote folder browsing. */
  mobileCompanion: 'mobile-companion',
  liveActivities: 'mobile-live-activities',
  /** GET /events server-sent events carrying { channel, payload }. */
  events: 'events',
  /** The server can ask a local client to run native dialogs (folder picker, reveal in Finder). */
  hostRequests: 'host-requests',
  /** The server also accepts bearer-authenticated TCP connections. */
  remote: 'remote',
  /** POST /pair trades a one-time code for a per-device token that can be revoked on its own. */
  pairing: 'pairing',
} as const
export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES]

/** Where a client reaches a workspace server. */
export type RuntimeEndpoint =
  | { kind: 'socket'; path: string }
  | { kind: 'http'; url: string; token: string }

export const AUTH_SCHEME = 'Bearer'
export const PAIR_PATH = '/pair'

/** Body of `POST /pair`. The code comes from `ramu pair` on the server's computer; it works once and expires. */
export interface PairRequest { code: string; name?: string }
export interface PairResponse { deviceId: string; token: string }
export const PROTOCOL_HEADER = 'x-ramu-protocol'
export const MAX_REQUEST_BYTES = 16_000_000

export interface InvokeRequest { method: string; args: unknown[] }

const UNDEFINED_MARKER = '$ramuUndefined'

/** JSON drops `undefined`; the marker keeps optional arguments in their positions. */
export function encodeInvoke(method: string, args: unknown[] = []): string {
  return JSON.stringify({ method, args }, (_key, value) => value === undefined ? { [UNDEFINED_MARKER]: true } : value)
}

export function decodeInvoke(text: string): InvokeRequest {
  return JSON.parse(text || '{}', (_key, value) => value && typeof value === 'object' && Object.keys(value).length === 1 && value[UNDEFINED_MARKER] === true ? undefined : value)
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

/** A short-lived manual pairing offer, safe to display as a QR code. Never contains a device token. */
export interface PairQrOffer { kind: 'ramu-pair'; version: 1; url: string; code: string; expiresAt: number }
export function encodePairQr(offer: Omit<PairQrOffer, 'kind' | 'version'>): string {
  return JSON.stringify({ kind: 'ramu-pair', version: 1, ...offer })
}
export function decodePairQr(text: string, now = Date.now()): PairQrOffer {
  if (text.length > 4096) throw new Error('Unrecognized pairing QR code')
  const offer = JSON.parse(text) as PairQrOffer
  if (offer.kind !== 'ramu-pair' || offer.version !== 1 || typeof offer.url !== 'string' || typeof offer.code !== 'string' || !/^[A-Z2-9]{5}-?[A-Z2-9]{5}$/.test(offer.code) || !Number.isFinite(offer.expiresAt)) throw new Error('Unrecognized pairing QR code')
  const url = new URL(offer.url)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid host address in QR code')
  if (offer.expiresAt <= now) throw new Error('This pairing code has expired. Create a new one on the computer.')
  return { ...offer, url: url.origin }
}
