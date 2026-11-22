import type { IncomingMessage } from 'node:http'
import { isIP } from 'node:net'

const isLoopback = (address: string) => /^(::ffff:)?127\./.test(address) || address === '::1'

const lastHeader = (req: IncomingMessage, name: string) => {
  const value = req.headers[name]
  return Array.isArray(value) ? value.at(-1) : value
}

/**
 * What delivers public requests to this host's listener: `cloudflare` for the tunnels Ramu runs through Cloudflare (Ramu
 * Link and quick tunnels), whose edge overwrites `CF-Connecting-IP`; `proxy` for any other public address (Tailscale
 * Funnel, ngrok, an address set by hand), which only appends to `X-Forwarded-For`; `null` with no public address.
 */
export type PublicTunnel = 'cloudflare' | 'proxy' | null

/**
 * Where a request came from, for per-address limits and pairing requests. A tunnel on this computer delivers every
 * request from loopback, so while a public address is set the tunnel's header names the visitor. Only Cloudflare's edge
 * sets `CF-Connecting-IP` itself; any other proxy passes through whatever the visitor sent, so there only the last
 * `X-Forwarded-For` entry, which the proxy appends, counts. From any other address a header could be forged, so it is
 * ignored. `tunneled` requests did not come from this network.
 */
export function clientAddress(req: IncomingMessage, tunnel: PublicTunnel): { address: string; tunneled: boolean } {
  const socket = req.socket.remoteAddress ?? 'unknown'
  if (!tunnel || !isLoopback(socket)) return { address: socket, tunneled: false }
  const visitor = [
    tunnel === 'cloudflare' ? lastHeader(req, 'cf-connecting-ip')?.trim() : undefined,
    lastHeader(req, 'x-forwarded-for')?.split(',').at(-1)?.trim(),
  ].find((value) => value && isIP(value))
  return { address: visitor ?? socket, tunneled: true }
}
