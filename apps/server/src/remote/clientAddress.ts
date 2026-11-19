import type { IncomingMessage } from 'node:http'
import { isIP } from 'node:net'

const isLoopback = (address: string) => /^(::ffff:)?127\./.test(address) || address === '::1'

const lastHeader = (req: IncomingMessage, name: string) => {
  const value = req.headers[name]
  return Array.isArray(value) ? value.at(-1) : value
}

/**
 * Where a request came from, for per-address limits and pairing requests. A tunnel on this computer (cloudflared,
 * Tailscale Funnel, ngrok) delivers every request from loopback, so while a public address is set the tunnel's header
 * names the visitor: Cloudflare's `CF-Connecting-IP`, else the last `X-Forwarded-For` entry, which the tunnel appends.
 * From any other address a header could be forged, so it is ignored. `tunneled` requests did not come from this network.
 */
export function clientAddress(req: IncomingMessage, behindTunnel: boolean): { address: string; tunneled: boolean } {
  const socket = req.socket.remoteAddress ?? 'unknown'
  if (!behindTunnel || !isLoopback(socket)) return { address: socket, tunneled: false }
  const visitor = [
    lastHeader(req, 'cf-connecting-ip')?.trim(),
    lastHeader(req, 'x-forwarded-for')?.split(',').at(-1)?.trim(),
  ].find((value) => value && isIP(value))
  return { address: visitor ?? socket, tunneled: true }
}
