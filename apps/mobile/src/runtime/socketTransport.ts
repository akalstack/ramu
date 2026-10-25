import { RuntimeSocket, type SocketFactory } from '@ramu/client-runtime/socket'
import { registerSocketProvider } from './transport'

/**
 * React Native's WebSocket accepts request headers as a third argument (a React Native extension), which the host's
 * header authentication needs. It does not report the HTTP status of a refused upgrade, so a refusal looks like an
 * ordinary close and the socket keeps its bounded, jittered retries; calls then use HTTP, which does report it.
 */
export const nativeSocketFactory: SocketFactory = (url, headers, handlers) => {
  const WS = globalThis.WebSocket as unknown as new (
    url: string,
    protocols: string | string[] | null,
    options: { headers: Record<string, string> },
  ) => WebSocket
  const ws = new WS(url, null, { headers })
  ws.onopen = () => handlers.onopen()
  ws.onmessage = (event) => {
    if (typeof event.data === 'string') handlers.onmessage(event.data)
  }
  ws.onerror = () => {}
  ws.onclose = () => handlers.onclose({})
  return { send: (text) => ws.send(text), close: () => ws.close() }
}

/**
 * Opt-in, like the desktop's `RAMU_SOCKET` (set `EXPO_PUBLIC_RAMU_SOCKET=1` for a build): the plan makes the socket the default only after a measured comparison. It
 * carries calls only; events keep their SSE stream so nothing is delivered twice.
 */
let enabled = process.env.EXPO_PUBLIC_RAMU_SOCKET === '1'
const sockets = new Map<string, RuntimeSocket>()

export function setSocketTransport(on: boolean) {
  enabled = on
  if (on) return
  for (const socket of sockets.values()) socket.close()
  sockets.clear()
}

/** The socket for this host and token, started on first use; null when sockets are off or the host cannot use them. */
export function socketFor(address: string, token: string): RuntimeSocket | null {
  if (!enabled) return null
  const key = `${address}#${token.length}:${token.slice(-8)}`
  let socket = sockets.get(key)
  if (!socket) {
    // A rotated token is a new socket; close the old one for this host.
    for (const [k, old] of sockets)
      if (k.startsWith(`${address}#`)) {
        old.close()
        sockets.delete(k)
      }
    socket = new RuntimeSocket({ url: address, token, factory: nativeSocketFactory, onEvent: () => {}, events: false })
    sockets.set(key, socket)
    socket.start()
  }
  return socket.state === 'rejected' || socket.state === 'unsupported' ? null : socket
}

registerSocketProvider(socketFor, (address, token) => {
  const key = `${address}#${token.length}:${token.slice(-8)}`
  sockets.get(key)?.close()
  sockets.delete(key)
})
