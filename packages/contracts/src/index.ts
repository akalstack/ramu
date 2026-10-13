// Wire contract between a Ramu workspace server and any client (desktop, web, mobile, relay).
// The method table and push events live in @ramu/shared/api; this file covers the transport around them.

/** Bumped when requests, events or authentication change incompatibly. */
export const PROTOCOL_VERSION = 1

/** Features a server advertises so independently updated clients can adapt. */
export const CAPABILITIES = {
  /** POST /invoke with { method, args }; the response is { value } or { error }. */
  invoke: 'invoke',
  /** GET /events server-sent events carrying { channel, payload }. */
  events: 'events',
  /** The server can ask a local client to run native dialogs (folder picker, reveal in Finder). */
  hostRequests: 'host-requests',
  /** The server also accepts bearer-authenticated TCP connections. */
  remote: 'remote',
} as const
export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES]

/** Where a client reaches a workspace server. */
export type RuntimeEndpoint =
  | { kind: 'socket'; path: string }
  | { kind: 'http'; url: string; token: string }

export const AUTH_SCHEME = 'Bearer'
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
