// Which addresses another device can use to reach this server. Ramu does not know or care which VPN supplies them:
// Tailscale, NetBird, ZeroTier, WireGuard and a plain LAN all appear as interfaces with addresses.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { isIP } from 'node:net'
import { networkInterfaces } from 'node:os'

export interface Candidate {
  url: string
  interface: string
}
type Interfaces = ReturnType<typeof networkInterfaces>

const isWildcard = (host: string) => host === '0.0.0.0' || host === '::'
const isLinkLocal = (address: string) => /^fe80:/i.test(address) || /^169\.254\./.test(address)

/** `host` is what the server listens on. A wildcard listens on every interface, so each usable address is a candidate. */
export function candidateUrls(
  host: string,
  port: number,
  tls: boolean,
  interfaces: Interfaces = networkInterfaces(),
): Candidate[] {
  const scheme = tls ? 'https' : 'http'
  const make = (address: string) => `${scheme}://${address.includes(':') ? `[${address}]` : address}:${port}`
  if (!isWildcard(host)) return [{ url: make(host), interface: 'listen address' }]
  const found: Candidate[] = []
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const info of addresses ?? []) {
      if (info.internal || isLinkLocal(info.address)) continue
      if (host === '0.0.0.0' && info.family !== 'IPv4') continue
      found.push({ url: make(info.address), interface: name })
    }
  }
  return found
}

/** What the Settings screen saves: whether to accept other devices, and where. A command-line `--listen` overrides it. */
export interface NetworkSetting {
  enabled: boolean
  host: string
  port: number
  acceptUnencrypted: boolean
  /** Advertise this host to nearby devices. Only effective while `enabled`; off by default. */
  discoverable: boolean
  /** The HTTPS address of a tunnel the person runs to this listener (cloudflared, Tailscale Funnel, ngrok), if any. */
  publicUrl: string | null
}
export const DEFAULT_NETWORK_PORT = 7788
export const DEFAULT_NETWORK_SETTING: NetworkSetting = {
  enabled: false,
  host: '0.0.0.0',
  port: DEFAULT_NETWORK_PORT,
  acceptUnencrypted: false,
  discoverable: false,
  publicUrl: null,
}

/** Every address another device could reach this computer on, for choosing which network to listen on. */
export function localAddresses(interfaces: Interfaces = networkInterfaces()): { name: string; address: string }[] {
  const found: { name: string; address: string }[] = []
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const info of addresses ?? [])
      if (!info.internal && !isLinkLocal(info.address)) found.push({ name, address: info.address })
  }
  return found
}

/**
 * A tunnel's public address: HTTPS, an origin only (no path, query or credentials), returned in its normal form. Empty
 * means none. Plain HTTP is refused because device tokens would cross the internet unencrypted.
 */
export function parsePublicUrl(input: unknown): string | null {
  if (input === null || input === undefined || input === '') return null
  if (typeof input !== 'string' || input.length > 200) throw new Error('Enter the tunnel’s https:// address')
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('Enter the tunnel’s https:// address')
  }
  if (url.protocol !== 'https:') throw new Error('The public address must start with https://')
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Enter only the address, such as https://ramu.example.com')
  return url.origin
}

/** Checks what a client sent before it is saved or bound. */
export function validateNetworkSetting(input: unknown, tls: boolean, addresses = localAddresses()): NetworkSetting {
  const value = input as Partial<NetworkSetting> | null
  if (!value || typeof value !== 'object') throw new Error('Invalid network settings')
  const { enabled, host, port, acceptUnencrypted } = value
  // Settings saved before discovery existed have no such field: it stays off until the person turns it on.
  const discoverable = value.discoverable ?? false
  const publicUrl = parsePublicUrl(value.publicUrl)
  if (
    typeof enabled !== 'boolean' ||
    typeof host !== 'string' ||
    typeof port !== 'number' ||
    typeof acceptUnencrypted !== 'boolean' ||
    typeof discoverable !== 'boolean'
  )
    throw new Error('Invalid network settings')
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port between 1024 and 65535')
  const known = isWildcard(host) || isLoopback(host) || addresses.some((entry) => entry.address === host)
  if (!isIP(host) || !known) throw new Error('Choose one of this host’s addresses, or all networks')
  if (enabled && !isLoopback(host) && !tls && !acceptUnencrypted)
    throw new Error('Confirm that you trust the network: Ramu does not encrypt this connection')
  return { enabled, host, port, acceptUnencrypted, discoverable, publicUrl }
}

const isLoopback = (host: string) => host === '::1' || /^127\./.test(host)

/** A saved address that this computer no longer has (a VPN that is off) is kept, so access returns when the network does. */
export function readNetworkSetting(path: string, tls: boolean): NetworkSetting {
  try {
    const saved = JSON.parse(readFileSync(path, 'utf8'))
    return validateNetworkSetting(saved, tls, [{ name: 'saved', address: saved?.host }])
  } catch {
    return { ...DEFAULT_NETWORK_SETTING }
  }
}

export function writeNetworkSetting(path: string, setting: NetworkSetting) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, JSON.stringify(setting, null, 2), { mode: 0o600 })
}
