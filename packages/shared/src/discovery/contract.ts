// Automatic host discovery: the advertisement a Ramu host publishes on its local network and how a device reads one.
// Everything here is pure and treats every advertised byte as untrusted. A found host proves nothing: its identifier is
// a hint until a normal pairing and an authenticated request confirm it, and nothing here grants access.

/** DNS-SD service type. The same name is used by the host's advertiser and every device's browser. */
export const DISCOVERY_SERVICE = '_ramu._tcp'
export const DISCOVERY_DOMAIN = 'local'
/** Bumped only for an incompatible change to the TXT metadata. Newer advertisements are listed as unsupported. */
export const DISCOVERY_VERSION = 1

/** Longest display name published or shown. DNS labels are limited to 63 bytes. */
export const MAX_DISCOVERY_NAME = 48
const MAX_TXT_VALUE = 120
export const MAX_DISCOVERY_HOSTS = 50
/** Longest a browse runs before it stops itself and offers Retry. */
export const MAX_BROWSE_MS = 120_000

/**
 * The whole published metadata. Display name, an opaque random identifier, the protocol version and the transport.
 * It never carries pairing codes, tokens, project paths, user names, provider accounts or addresses (those come from
 * the DNS records themselves).
 */
export interface DiscoveryAdvert {
  version: number
  hostId: string
  name: string
  scheme: 'http' | 'https'
}

const HOST_ID = /^[0-9a-f]{16,32}$/

/** Control characters, bidi overrides and line breaks are removed, so a hostile name cannot spoof or break a row. */
export function cleanDiscoveryName(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_DISCOVERY_NAME)
      .trim()
  )
}

/** TXT entries as `key=value` strings, in a fixed order. */
export function encodeAdvert(advert: DiscoveryAdvert): string[] {
  return [
    `v=${advert.version}`,
    `id=${advert.hostId}`,
    `scheme=${advert.scheme}`,
    `name=${cleanDiscoveryName(advert.name)}`,
  ]
}

export type AdvertResult = { ok: true; advert: DiscoveryAdvert } | { ok: false; reason: 'malformed' | 'incompatible' }

/** Reads TXT strings (or an already split record). Unknown keys are ignored; known ones are length and shape checked. */
export function parseAdvert(entries: readonly string[] | Readonly<Record<string, string>>): AdvertResult {
  const map = new Map<string, string>()
  const pairs = Array.isArray(entries) ? entries : Object.entries(entries).map(([key, value]) => `${key}=${value}`)
  if (pairs.length > 32) return { ok: false, reason: 'malformed' }
  for (const entry of pairs as readonly string[]) {
    if (typeof entry !== 'string' || entry.length > MAX_TXT_VALUE + 16) continue
    const at = entry.indexOf('=')
    if (at < 1) continue
    const key = entry.slice(0, at).toLowerCase()
    if (!map.has(key)) map.set(key, entry.slice(at + 1))
  }
  const version = Number(map.get('v'))
  if (!Number.isInteger(version) || version < 1) return { ok: false, reason: 'malformed' }
  // A newer layout may change any field, so it is not interpreted.
  if (version > DISCOVERY_VERSION) return { ok: false, reason: 'incompatible' }
  const hostId = map.get('id') ?? ''
  const scheme = map.get('scheme')
  const name = cleanDiscoveryName(map.get('name') ?? '')
  if (!HOST_ID.test(hostId) || (scheme !== 'http' && scheme !== 'https') || !name)
    return { ok: false, reason: 'malformed' }
  return { ok: true, advert: { version, hostId, name, scheme } }
}

export interface Endpoint {
  address: string
  port: number
  scheme: 'http' | 'https'
}

/**
 * The address form discovery will hand to pairing: a public-looking IPv4 or IPv6 literal. Zone-scoped (`%en0`),
 * link-local, loopback, multicast and unspecified addresses are not offered, and neither is any hostname: a TXT or SRV
 * field can never make a device fetch an arbitrary URL.
 */
export function usableAddress(address: string): boolean {
  if (/%/.test(address)) return false
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address)
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number]
    if ([a, b, c, d].some((part) => part > 255)) return false
    if (a === 0 || a === 127 || a >= 224) return false
    if (a === 169 && b === 254) return false
    return true
  }
  if (!/^[0-9a-f:]+$/i.test(address) || !address.includes(':') || address.length > 45) return false
  const lower = address.toLowerCase()
  if (lower === '::' || lower === '::1' || /^fe[89ab]/.test(lower) || /^ff/.test(lower)) return false
  return true
}

/** The base URL a pairing form is filled with. Null when the endpoint is not something discovery may offer. */
export function endpointUrl(endpoint: Endpoint): string | null {
  if (!Number.isInteger(endpoint.port) || endpoint.port < 1024 || endpoint.port > 65535) return null
  if (!usableAddress(endpoint.address)) return null
  const host = endpoint.address.includes(':') ? `[${endpoint.address}]` : endpoint.address
  return `${endpoint.scheme}://${host}:${endpoint.port}`
}
