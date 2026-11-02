import { RuntimeSocket, type SocketFactory } from '@ramu/client-runtime/socket'
import { hostSubscription, type Interest } from './hostSubscription'
import { registerSocketProvider, type HostSocket } from './transport'
import { linkAware } from './link'

/**
 * React Native's WebSocket accepts request headers as a third argument (a React Native extension), which the host's
 * header authentication needs. It does not report the HTTP status of a refused upgrade, so a refusal looks like an
 * ordinary close and the socket keeps its bounded, jittered retries; the host answers the first call over the socket
 * with its own error, which the caller reports.
 */
export const nativeSocketFactory: SocketFactory = (url, headers, handlers) => {
  const WS = globalThis.WebSocket as unknown as new (
    url: string,
    protocols: string | string[] | null,
    options: { headers: Record<string, string> },
  ) => WebSocket
  // Native bearer-authenticated clients have no browser origin. Explicitly suppress
  // Android's synthesized HTTP Origin; the server keeps its browser allowlist intact.
  const ws = new WS(url, null, { headers: { ...headers, origin: '' } })
  ws.onopen = () => handlers.onopen()
  ws.onmessage = (event) => {
    if (typeof event.data === 'string') handlers.onmessage(event.data)
  }
  ws.onerror = () => {}
  ws.onclose = () => handlers.onclose({})
  return { send: (text) => ws.send(text), close: () => ws.close() }
}

interface Listener {
  event(channel: string, payload: unknown): void
  state?(state: string): void
}
interface Entry {
  socket: RuntimeSocket
  listeners: Set<Listener>
  interests: Set<Interest>
}
/** Narrows the host's pushes to what the phone shows; the socket restores it after a reconnect. */
function narrow(entry: Entry) {
  const { channels, keys, skip } = hostSubscription(entry.interests)
  void entry.socket.subscribe(channels, keys, skip).catch(() => {})
}
const hosts = new Map<string, Entry>()
const keyOf = (address: string, token: string) => `${address}#${token.length}:${token.slice(-8)}`

/**
 * The phone talks to a host over one WebSocket, as T3 Code's clients do: every call and every event, with no HTTP
 * fallback. HTTP remains for pairing and token renewal, which happen before a socket can be authenticated. The socket
 * keeps itself connected with bounded, jittered retries; the store hydrates again whenever a stream ends.
 */
export function socketFor(address: string, token: string): HostSocket {
  const key = keyOf(address, token)
  let entry = hosts.get(key)
  if (!entry) {
    // A rotated token is a new socket; close the old one for this host.
    for (const [k, old] of hosts)
      if (k.startsWith(`${address}#`)) {
        old.socket.close()
        hosts.delete(k)
      }
    const listeners = new Set<Listener>()
    const socket = new RuntimeSocket({
      url: address,
      token,
      factory: linkAware(nativeSocketFactory),
      // A phone changes networks frequently; detect a silent old route within about 30 seconds.
      heartbeatMs: 10_000,
      onEvent: (channel, payload) => {
        for (const listener of [...listeners]) listener.event(channel, payload)
      },
      onState: (state) => {
        for (const listener of [...listeners]) listener.state?.(state)
      },
      // Terminal output is acknowledged as it is handled; a slow phone is told to fetch the gap instead of buffering it.
      flowControl: true,
    })
    entry = { socket, listeners, interests: new Set() }
    hosts.set(key, entry)
    narrow(entry)
    socket.start()
  }
  const { socket, listeners, interests } = entry
  const current = entry
  return {
    get state() {
      return socket.state
    },
    whenReady: (timeoutMs, signal) => socket.whenReady(timeoutMs, signal),
    invoke: (method, args, options) => socket.invoke(method, args, options),
    watch: (channels, keys) => {
      const interest: Interest = { channels, ...(keys ? { keys } : {}) }
      interests.add(interest)
      narrow(current)
      return () => {
        interests.delete(interest)
        narrow(current)
      }
    },
    listen: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

registerSocketProvider(
  socketFor,
  (address, token) => {
    const key = keyOf(address, token)
    hosts.get(key)?.socket.close()
    hosts.delete(key)
  },
  async (address, token, signal) => {
    // Discovery must not borrow and then close the conversation's pooled socket at the same address.
    const socket = new RuntimeSocket({
      url: address,
      token,
      factory: linkAware(nativeSocketFactory),
      events: false,
      connectTimeoutMs: 3000,
      onEvent() {},
    })
    const close = () => socket.close()
    signal.addEventListener('abort', close, { once: true })
    try {
      if (signal.aborted) return false
      socket.start()
      await socket.whenReady(3000, signal)
      const info = (await socket.invoke('background.status', [], { signal, timeoutMs: 3000 })) as {
        protocol?: number
        capabilities?: unknown
      } | null
      return info?.protocol === 1 && Array.isArray(info.capabilities) && info.capabilities.includes('mobile-companion')
    } finally {
      signal.removeEventListener('abort', close)
      close()
    }
  },
)
