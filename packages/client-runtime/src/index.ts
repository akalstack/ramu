// Node-side connection to a Ramu workspace server: request/response calls and a reconnecting event stream.
// Used by the Electron main process, the server CLI and, later, remote clients.
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { remoteRequests, WorkLimiter } from './limits'
import type { RamuMethods } from '@ramu/shared/api'

// Local startup hydrates many panels at once. Stay below the service's per-connection request budget.
const localRequests = new WorkLimiter(24, 24)
import { runtimeNetwork, type NetworkMonitor } from './network'
import { forgetHostSocket, hostSocket, listenToHost, type HostListener } from './hostSocket'
export { refreshRuntimeNetwork } from './network'
export { runtimeNetwork } from './network'
export { PresenceListener, presenceKey, presenceMessage } from './presence'
export { RuntimeSocket, type SocketFactory, type SocketState } from './socket'
export { nodeSocketFactory } from './nodeSocket'
export { closeHostSockets, forgetHostSocket, hostSocket, listenToHost } from './hostSocket'
export type { HostListener } from './hostSocket'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  AUTH_SCHEME,
  PAIR_PATH,
  RENEW_PATH,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  RECOVERABLE_MUTATIONS,
  parseRemoteUrl,
  type PairResponse,
  type RenewResponse,
  type RuntimeEndpoint,
} from '@ramu/contracts'

export type { RuntimeEndpoint } from '@ramu/contracts'

/** Short per-profile socket path: unix socket paths are limited to about 100 bytes, so it lives in the temp directory. */
export function runtimeSocket(userData: string): string {
  return join(
    tmpdir(),
    `ramu-${process.getuid?.() ?? 'user'}-${createHash('sha256').update(userData).digest('hex').slice(0, 20)}.sock`,
  )
}

/** A bare string is a unix socket path. */
export function toEndpoint(target: string | RuntimeEndpoint): RuntimeEndpoint {
  return typeof target === 'string' ? { kind: 'socket', path: target } : target
}

export interface InvokeOptions {
  signal?: AbortSignal
  timeoutMs?: number
  /** Marks one logical mutation across retries; the host runs it once. */
  operationKey?: string
}
/** A method's result as the API table declares it; the host validated the call and built the result. */
export type RuntimeResult<M extends string> = M extends keyof RamuMethods
  ? Awaited<ReturnType<RamuMethods[M]>>
  : unknown

export async function runtimeInvoke<M extends string>(
  target: string | RuntimeEndpoint,
  method: M,
  args: unknown[] = [],
  policy: InvokeOptions = {},
): Promise<RuntimeResult<M>> {
  const endpoint = toEndpoint(target)
  const release =
    endpoint.kind === 'http'
      ? await remoteRequests.acquire(new URL(endpoint.url).origin, policy.signal)
      : await localRequests.acquire(endpoint.path, policy.signal)
  try {
    // A host is called over its one socket, waiting briefly for it to connect. There is no second transport: a refused
    // token or a host without a socket is reported as such. A call lost after it was sent has an unknown outcome; one
    // never sent is retried once on the reconnected socket. The service on this machine fails at once when nothing
    // listens, with the connection error code (ENOENT, ECONNREFUSED) the app uses to decide whether to start it.
    const options = {
      ...(policy.operationKey ? { operationKey: policy.operationKey } : {}),
      ...(policy.timeoutMs ? { timeoutMs: policy.timeoutMs } : {}),
      ...(policy.signal ? { signal: policy.signal } : {}),
    }
    const local = endpoint.kind === 'socket'
    const socket = hostSocket(endpoint)
    for (let attempt = 0; ; attempt++) {
      try {
        await socket.whenReady(Math.min(policy.timeoutMs ?? 10_000, 10_000), policy.signal, { failFast: local })
      } catch (error) {
        if (local && (error as { code?: string }).code) forgetHostSocket(endpoint)
        throw error
      }
      try {
        return (await socket.invoke(method, args, options)) as RuntimeResult<M>
      } catch (error) {
        if (!(error as { notSent?: boolean }).notSent || attempt >= 1) throw error
      }
    }
  } finally {
    release()
  }
}

const TRANSPORT_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ECONNABORTED', 'ENETUNREACH'])

/** A failure of the connection itself, as opposed to an answer from the host, which is final. */
export function isTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as NodeJS.ErrnoException).code
  if (code && TRANSPORT_CODES.has(code)) return true
  // A reply cut off mid-body does not parse; a request that outlived its deadline is destroyed by the client.
  return error instanceof SyntaxError || /timed out|socket hang up|aborted/i.test(error.message)
}

export interface RecoverableInvokeOptions extends InvokeOptions {
  /** Retries after a lost connection; each waits `backoffMs * 3 ** attempt`. */
  retries?: number
  backoffMs?: number
  /** Supplies the operation key; defaults to a random UUID. */
  newKey?: () => string
}

/**
 * Like `runtimeInvoke`, and for a listed mutation, retries a lost connection under one operation key so the host returns
 * the first result instead of running it again. A method outside the list and an answer from the host (an error reply)
 * are never retried: the outcome stays the caller's to reconcile.
 */
export async function runtimeInvokeRecoverable<M extends string>(
  target: string | RuntimeEndpoint,
  method: M,
  args: unknown[] = [],
  policy: RecoverableInvokeOptions = {},
): Promise<RuntimeResult<M>> {
  if (policy.operationKey || !RECOVERABLE_MUTATIONS.has(method)) return runtimeInvoke(target, method, args, policy)
  const operationKey = (policy.newKey ?? (() => randomUUID()))()
  const retries = policy.retries ?? 2
  const backoffMs = policy.backoffMs ?? 500
  for (let attempt = 0; ; attempt++) {
    try {
      return await runtimeInvoke(target, method, args, { ...policy, operationKey })
    } catch (error) {
      if (attempt >= retries || policy.signal?.aborted || !isTransportFailure(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, backoffMs * 3 ** attempt))
    }
  }
}

/** Trades a pairing code for this device's own token. Save the token; it is not shown again. */
export function runtimePair(serverUrl: string, code: string, name?: string, kind?: 'host'): Promise<PairResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(parseRemoteUrl(serverUrl))
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      {
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: PAIR_PATH,
        method: 'POST',
        headers: { [PROTOCOL_HEADER]: String(PROTOCOL_VERSION), 'Content-Type': 'application/json' },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('error', reject)
        res.on('end', () => {
          if (res.statusCode === 429) return reject(new Error('Too many failed attempts; try again shortly'))
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString())
            body.error || !body.token
              ? reject(new Error(body.error ?? 'The server did not return a token'))
              : resolve(body)
          } catch (error) {
            reject(error)
          }
        })
      },
    )
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('Pairing request timed out')))
    req.end(JSON.stringify({ code, name, ...(kind ? { kind } : {}) }))
  })
}

/** Asks a host to swap this device's token for a fresh one. Save the new token before using it; null when the host says no. */
export function runtimeRenew(serverUrl: string, token: string): Promise<RenewResponse | null> {
  return new Promise((resolve, reject) => {
    const url = new URL(parseRemoteUrl(serverUrl))
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      {
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: RENEW_PATH,
        method: 'POST',
        headers: { [PROTOCOL_HEADER]: String(PROTOCOL_VERSION), Authorization: `${AUTH_SCHEME} ${token}` },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('error', reject)
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null)
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString())
            resolve(typeof body.token === 'string' && /^[a-f0-9]{64}$/.test(body.token) ? body : null)
          } catch {
            resolve(null)
          }
        })
      },
    )
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('Renewal request timed out')))
    req.end()
  })
}

/**
 * Remote streams retry briefly, then wait quietly for network changes or a five-minute availability check.
 * No requests are sent with no usable network. Loopback and local sockets remain usable offline.
 */
export interface SubscribeOptions {
  /** Local desktop identity used to bind private broker messages to this event stream. Never sent to a remote host. */
  localClientId?: string
  retryMode?: 'events' | 'periodic'
  /** Treat the host as needing the network even if its address is loopback (tests, tunnels). Derived from the address when absent. */
  networkBound?: boolean
  presencePort?: number
  watchWake?: (wake: () => void) => () => void
}
export function subscribeRuntime(
  target: string | RuntimeEndpoint,
  receive: (channel: string, payload: unknown) => void,
  monitor: NetworkMonitor = runtimeNetwork,
  policy: SubscribeOptions = {},
): () => void {
  return subscribeSocket(toEndpoint(target), receive, monitor, policy)
}

/**
 * Events from a host arrive on its one socket, shared with that host's calls: a remote host's WebSocket, or the local
 * service's unix socket. The socket keeps its own bounded, jittered reconnects; this adds what the desktop needs on
 * top: nothing is sent to a remote host without a usable network, a network change or wake reconnects at once, a
 * refused token ends the subscription without retrying, and the local service is retried quickly and without limit.
 */
function subscribeSocket(
  endpoint: RuntimeEndpoint,
  receive: (channel: string, payload: unknown) => void,
  monitor: NetworkMonitor,
  policy: SubscribeOptions,
): () => void {
  const remote = endpoint.kind === 'http'
  const hostname = remote ? new URL(endpoint.url).hostname.replace(/^\[|\]$/g, '') : ''
  const needsNetwork =
    remote && (policy.networkBound ?? (hostname !== 'localhost' && hostname !== '::1' && !/^127\./.test(hostname)))
  const unavailable = () => needsNetwork && !monitor.current().available
  let closed = false,
    connected = false,
    restarted = false,
    failures = 0,
    quiet: NodeJS.Timeout | undefined,
    offNetwork = () => {},
    offWake = () => {}
  const report = (waiting: 'network' | 'computer') => receive('background:connection', { connected: false, waiting })
  const shutdown = () => {
    closed = true
    clearTimeout(quiet)
    offNetwork()
    offWake()
    listening.stop()
  }
  const listener: HostListener = {
    event: (channel, payload) => {
      if (!closed) receive(channel, payload)
    },
    restart: () => {
      restarted = true
    },
    state: (state) => {
      if (closed) return
      if (state === 'ready') {
        connected = true
        receive('background:connection', { connected: true })
        if (restarted) receive('background:connection', { connected: true, restarted: true })
        restarted = false
      } else if (state === 'rejected') {
        shutdown()
        receive('background:connection', { connected: false, rejected: true })
      } else if (connected || state === 'unsupported') {
        connected = false
        if (!unavailable()) report('computer')
      }
      if (state === 'closed' && !connected) {
        // Try briefly, then stop probing: an announcement or wake reconnects at once, and 'periodic' hosts also get one
        // quiet check every five minutes.
        if (remote && ++failures > 3 && !unavailable()) {
          socket.suspend()
          report('computer')
          if (policy.retryMode !== 'events') {
            clearTimeout(quiet)
            quiet = setTimeout(() => !closed && socket.resume(), 300_000)
            quiet.unref?.()
          }
        }
      }
      if (state === 'ready') failures = 0
    },
  }
  const listening = listenToHost(endpoint, listener, {
    ...(remote && policy.presencePort ? { presencePort: policy.presencePort } : {}),
    ...(!remote && policy.localClientId && /^[a-zA-Z0-9-]{1,100}$/.test(policy.localClientId)
      ? { clientId: policy.localClientId }
      : {}),
  })
  const socket = listening.socket
  if (needsNetwork)
    offNetwork = monitor.subscribe((force) => {
      if (closed) return
      if (unavailable()) {
        connected = false
        socket.suspend()
        report('network')
      } else if (!connected || force) {
        failures = 0
        socket.resume(force)
      }
    })
  if (remote && policy.watchWake)
    offWake = policy.watchWake(() => {
      if (!closed && !connected) {
        failures = 0
        socket.resume()
      }
    })
  if (unavailable()) {
    socket.suspend()
    report('network')
  } else if (socket.state === 'ready') listener.state?.('ready')
  return shutdown
}
