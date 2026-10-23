import { createHash } from 'node:crypto'
import type { RuntimeEndpoint } from '@ramu/contracts'
import { nodeSocketFactory } from './nodeSocket'
import { RuntimeSocket } from './socket'

/**
 * An opt-in way to send calls over a WebSocket instead of one HTTP request each. Off unless `RAMU_SOCKET=1` or switched
 * on in code: the plan makes it the default only after a measured comparison. Events keep their SSE stream, so the
 * socket asks for calls only and nothing is delivered twice.
 */
let enabled = process.env.RAMU_SOCKET === '1'
const sockets = new Map<string, RuntimeSocket>()

export function setSocketTransport(on: boolean) {
  enabled = on
  if (!on) {
    for (const socket of sockets.values()) socket.close()
    sockets.clear()
  }
}

/** The socket for this host and credential, started on first use; null when sockets are off or the host cannot use them. */
export function socketFor(endpoint: Extract<RuntimeEndpoint, { kind: 'http' }>): RuntimeSocket | null {
  if (!enabled) return null
  // The key never holds the token itself: a rotated token is a new socket, and an old one is closed with its host entry.
  const key = `${new URL(endpoint.url).origin}#${createHash('sha256').update(endpoint.token).digest('hex').slice(0, 16)}`
  let socket = sockets.get(key)
  if (!socket) {
    socket = new RuntimeSocket({
      url: endpoint.url,
      token: endpoint.token,
      factory: nodeSocketFactory,
      onEvent: () => {},
      events: false,
    })
    sockets.set(key, socket)
    socket.start()
  }
  return socket.state === 'rejected' || socket.state === 'unsupported' ? null : socket
}
