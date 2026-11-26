import { createHash } from 'node:crypto'
import type { RuntimeEndpoint } from '@ramu/contracts'
import { deviceProver } from './deviceProver'
import { nodeSocketFactory } from './nodeSocket'
import { RuntimeSocket, type SocketState } from './socket'

/** What a consumer of a host's socket hears: its events and its connection state. */
export interface HostListener {
  event(channel: string, payload: unknown): void
  state?(state: SocketState, resumed?: boolean): void
  /** The host restarted: every cursor held against it is void. */
  restart?(): void
}
interface Entry {
  socket: RuntimeSocket
  listeners: Set<HostListener>
  presencePort?: number
  clientId?: string
}
/** Per-connection details a consumer may add: the desktop's presence port to a remote host, or its private identity to the local service. */
export interface HostSocketOptions {
  presencePort?: number
  clientId?: string
}

/**
 * One WebSocket per host and credential carries every call and every event for all of this process's consumers, as in
 * T3 Code's single RPC socket: calls wait for it to be ready rather than falling back to another transport. HTTP stays
 * for pairing, renewal and health, which happen before a socket can be authenticated.
 */
const hosts = new Map<string, Entry>()

const keyOf = (endpoint: RuntimeEndpoint) =>
  // The key never holds the token itself: a rotated token is a new socket, and the old one is closed with its entry.
  endpoint.kind === 'socket'
    ? `unix:${endpoint.path}#`
    : `${new URL(endpoint.url).origin}#${createHash('sha256').update(endpoint.token).digest('hex').slice(0, 16)}`

const same = (held: Entry, options: HostSocketOptions) =>
  (options.presencePort === undefined || held.presencePort === options.presencePort) &&
  (options.clientId === undefined || held.clientId === options.clientId)

export function hostSocket(endpoint: RuntimeEndpoint, options: HostSocketOptions = {}): RuntimeSocket {
  const key = keyOf(endpoint)
  const origin = key.slice(0, key.indexOf('#'))
  const held = hosts.get(key)
  if (held && same(held, options)) return held.socket
  // A rotated token or a new presence port replaces the connection but keeps its listeners.
  const listeners = held?.listeners ?? new Set<HostListener>()
  for (const [k, old] of hosts)
    if (k === key || k.startsWith(`${origin}#`)) {
      old.socket.close()
      hosts.delete(k)
      for (const l of old.listeners) listeners.add(l)
    }
  return open(endpoint, listeners, {
    presencePort: options.presencePort ?? held?.presencePort,
    clientId: options.clientId ?? held?.clientId,
  }).socket
}

function open(
  endpoint: RuntimeEndpoint,
  listeners: Set<HostListener>,
  { presencePort, clientId }: { presencePort: number | undefined; clientId: string | undefined },
  epoch: string | null = null,
): Entry {
  const local = endpoint.kind === 'socket'
  const entry: Entry = {
    listeners,
    ...(presencePort !== undefined ? { presencePort } : {}),
    ...(clientId !== undefined ? { clientId } : {}),
    socket: new RuntimeSocket({
      url: local ? `ws+unix://${endpoint.path}` : endpoint.url,
      token: local ? '' : endpoint.token,
      factory: nodeSocketFactory,
      epoch,
      // This device's key, when the app holds one; the service on this machine has no token to prove.
      ...(local ? {} : { prover: deviceProver() ?? undefined }),
      // The service on this machine comes back quickly after a restart; a remote host backs off further.
      ...(local ? { maxBackoffMs: 2000 } : {}),
      headers: {
        ...(presencePort && !local ? { 'X-Ramu-Presence-Port': String(presencePort) } : {}),
        // A private desktop identity binds only to the local service, never to a remote host.
        ...(clientId && local ? { 'X-Ramu-Desktop-Client': clientId } : {}),
      },
      onEvent: (channel, payload) => {
        for (const l of [...listeners]) l.event(channel, payload)
      },
      onState: (state, resumed) => {
        for (const l of [...listeners]) l.state?.(state, resumed)
      },
      onRestart: () => {
        for (const l of [...listeners]) l.restart?.()
      },
    }),
  }
  hosts.set(keyOf(endpoint), entry)
  entry.socket.start()
  return entry
}

/** Hears a host's events and state until the returned function is called; the socket itself is shared and stays open. */
export function listenToHost(
  endpoint: RuntimeEndpoint,
  listener: HostListener,
  options: HostSocketOptions = {},
): { socket: RuntimeSocket; stop(): void } {
  const socket = hostSocket(endpoint, options)
  const entry = hosts.get(keyOf(endpoint))!
  entry.listeners.add(listener)
  return { socket, stop: () => entry.listeners.delete(listener) }
}

/** Closes every host socket: on shutdown, and between tests. */
export function closeHostSockets() {
  for (const entry of hosts.values()) entry.socket.close()
  hosts.clear()
}

/**
 * Forgets one host's socket (closing it), for a one-shot caller whose connection attempt failed. The service on this
 * machine keeps its listeners on a fresh connection: the desktop's event stream must hear that service again once it
 * is back, as after a restart, rather than wait on a socket nobody reopens.
 */
export function forgetHostSocket(endpoint: RuntimeEndpoint) {
  const key = keyOf(endpoint)
  const held = hosts.get(key)
  if (!held) return
  held.socket.close()
  hosts.delete(key)
  if (endpoint.kind === 'socket' && held.listeners.size)
    open(endpoint, held.listeners, { presencePort: held.presencePort, clientId: held.clientId }, held.socket.runId)
}
