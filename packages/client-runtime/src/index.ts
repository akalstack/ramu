// Node-side connection to a Ramu workspace server: request/response calls and a reconnecting event stream.
// Used by the Electron main process, the server CLI and, later, remote clients.
import { request as httpRequest, type RequestOptions } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { connectionAttempts, remoteRequests, type WorkLimiter } from './limits'
import { runtimeNetwork, type NetworkMonitor } from './network'
export { refreshRuntimeNetwork } from './network'
export { runtimeNetwork } from './network'
export { PresenceListener, presenceKey, presenceMessage } from './presence'
export { RuntimeSocket, type SocketFactory, type SocketState } from './socket'
export { nodeSocketFactory } from './nodeSocket'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  AUTH_SCHEME,
  PAIR_PATH,
  RENEW_PATH,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  RECOVERABLE_MUTATIONS,
  encodeInvoke,
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

function prepare(
  target: string | RuntimeEndpoint,
  path: string,
  method: 'GET' | 'POST',
  extra: Record<string, string> = {},
): { options: RequestOptions; send: typeof httpRequest } {
  const endpoint = toEndpoint(target)
  const headers: Record<string, string> = { [PROTOCOL_HEADER]: String(PROTOCOL_VERSION), ...extra }
  if (endpoint.kind === 'socket')
    return { options: { socketPath: endpoint.path, path, method, headers }, send: httpRequest }
  const url = new URL(endpoint.url)
  headers.Authorization = `${AUTH_SCHEME} ${endpoint.token}`
  return {
    options: {
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname.replace(/\/$/, '')}${path}`,
      method,
      headers,
    },
    send: url.protocol === 'https:' ? httpsRequest : httpRequest,
  }
}

export interface InvokeOptions {
  signal?: AbortSignal
  timeoutMs?: number
  /** Marks one logical mutation across retries; a host that advertises `operation-keys` runs it once. */
  operationKey?: string
}
export async function runtimeInvoke(
  target: string | RuntimeEndpoint,
  method: string,
  args: unknown[] = [],
  policy: InvokeOptions = {},
): Promise<any> {
  const endpoint = toEndpoint(target)
  const release =
    endpoint.kind === 'http' ? await remoteRequests.acquire(new URL(endpoint.url).origin, policy.signal) : () => {}
  try {
    return await new Promise((resolve, reject) => {
      const { options, send } = prepare(target, '/invoke', 'POST', { 'Content-Type': 'application/json' })
      options.signal = policy.signal
      const req = send(options, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('error', reject)
        res.on('end', () => {
          if (res.statusCode === 401) return reject(new Error('The server rejected the access token'))
          if (res.statusCode === 429) return reject(new Error('Too many failed attempts; try again shortly'))
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString())
            body.error ? reject(new Error(body.error)) : resolve(body.value)
          } catch (e) {
            reject(e)
          }
        })
      })
      const deadline = setTimeout(
        () => req.destroy(new Error('Background service request timed out')),
        policy.timeoutMs ?? 180000,
      )
      req.once('close', () => clearTimeout(deadline))
      req.on('error', reject)
      req.end(encodeInvoke(method, args, policy.operationKey))
    })
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

const operationSupport = new Map<string, { supported: boolean; at: number }>()
const SUPPORT_TTL_MS = 10 * 60_000

async function supportsOperationKeys(target: string | RuntimeEndpoint, signal?: AbortSignal): Promise<boolean> {
  const endpoint = toEndpoint(target)
  const key = endpoint.kind === 'socket' ? endpoint.path : endpoint.url
  const known = operationSupport.get(key)
  if (known && Date.now() - known.at < SUPPORT_TTL_MS) return known.supported
  try {
    const status = (await runtimeInvoke(target, 'background.status', [], { signal, timeoutMs: 10_000 })) as {
      capabilities?: string[]
    }
    const supported = !!status?.capabilities?.includes('operation-keys')
    operationSupport.set(key, { supported, at: Date.now() })
    return supported
  } catch {
    return false
  }
}

export interface RecoverableInvokeOptions extends InvokeOptions {
  /** Retries after a lost connection; each waits `backoffMs * 3 ** attempt`. */
  retries?: number
  backoffMs?: number
  /** Supplies the operation key; defaults to a random UUID. */
  newKey?: () => string
}

/**
 * Like `runtimeInvoke`, and for a listed mutation, retries a lost connection under one operation key so a host that
 * advertises `operation-keys` returns the first result instead of running it again. A host that does not advertise it,
 * a method outside the list and an answer from the host (an error reply) are never retried: the outcome stays the
 * caller's to reconcile.
 */
export async function runtimeInvokeRecoverable(
  target: string | RuntimeEndpoint,
  method: string,
  args: unknown[] = [],
  policy: RecoverableInvokeOptions = {},
): Promise<any> {
  if (
    policy.operationKey ||
    !RECOVERABLE_MUTATIONS.has(method) ||
    !(await supportsOperationKeys(target, policy.signal))
  )
    return runtimeInvoke(target, method, args, policy)
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
export function runtimePair(serverUrl: string, code: string, name?: string): Promise<PairResponse> {
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
    req.end(JSON.stringify({ code, name }))
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
  presencePort?: number
  watchWake?: (wake: () => void) => () => void
  attempts?: WorkLimiter
}
export function subscribeRuntime(
  target: string | RuntimeEndpoint,
  receive: (channel: string, payload: any) => void,
  monitor: NetworkMonitor = runtimeNetwork,
  policy: SubscribeOptions = {},
): () => void {
  let closed = false,
    retry: NodeJS.Timeout | undefined,
    active: ReturnType<typeof httpRequest> | undefined,
    failures = 0
  // The host's run identity from its last connection; a different one means it restarted and held cursors are void.
  let epoch: string | null = null
  let generation = 0,
    connected = false,
    connecting = false,
    offNetwork = () => {},
    offWake = () => {}
  const endpoint = toEndpoint(target),
    remote = endpoint.kind === 'http'
  const attempts = policy.attempts ?? connectionAttempts
  let cancelQueued = () => {},
    releaseAttempt = () => {}
  const hostname = remote ? new URL(endpoint.url).hostname.replace(/^\[|\]$/g, '') : ''
  const needsNetwork = remote && hostname !== 'localhost' && hostname !== '::1' && !/^127\./.test(hostname)
  const unavailable = () => needsNetwork && !monitor.current().available
  const report = (waiting: 'network' | 'computer', retryAt?: number) =>
    receive('background:connection', { connected: false, waiting, retryAt })
  const startAttempt = () => {
    if (closed) return
    clearTimeout(retry)
    retry = undefined
    if (unavailable()) {
      connecting = false
      releaseAttempt()
      releaseAttempt = () => {}
      report('network')
      return
    }
    const attempt = ++generation
    active?.destroy()
    connected = false
    connecting = true
    const extra: Record<string, string> =
      remote && policy.presencePort ? { 'X-Ramu-Presence-Port': String(policy.presencePort) } : {}
    if (!remote && policy.localClientId && /^[a-zA-Z0-9-]{1,100}$/.test(policy.localClientId))
      extra['X-Ramu-Desktop-Client'] = policy.localClientId
    const { options, send } = prepare(target, '/events', 'GET', extra)
    let finished = false,
      deadline: NodeJS.Timeout | undefined
    const disconnected = () => {
      if (closed || finished || attempt !== generation) return
      finished = true
      connected = false
      connecting = false
      clearTimeout(deadline)
      releaseAttempt()
      releaseAttempt = () => {}
      active?.destroy()
      if (unavailable()) {
        report('network')
        return
      }
      const delay = remote
        ? ++failures <= 3
          ? 1000 * 2 ** (failures - 1)
          : policy.retryMode === 'events'
            ? null
            : 300000
        : 1000
      if (delay === null) {
        report('computer')
        return
      }
      report('computer', Date.now() + delay)
      retry = setTimeout(connect, delay)
    }
    deadline = setTimeout(disconnected, 10000)
    active = send(options, (res) => {
      if (closed || attempt !== generation) {
        res.destroy()
        return
      }
      clearTimeout(deadline)
      releaseAttempt()
      releaseAttempt = () => {}
      if (res.statusCode === 401) {
        res.resume()
        closed = true
        connecting = false
        offNetwork()
        offWake()
        receive('background:connection', { connected: false, rejected: true })
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        disconnected()
        return
      }
      connected = true
      connecting = false
      // A brief successful connection must not reset the backoff of a flapping host.
      const started = Date.now()
      receive('background:connection', { connected: true })
      let buffer = ''
      res.setEncoding('utf8')
      const heartbeat = () => {
        if (Date.now() - started >= 30000) failures = 0
        clearTimeout(deadline)
        deadline = setTimeout(disconnected, 60000)
      }
      heartbeat()
      res.on('data', (chunk) => {
        if (closed || attempt !== generation) return
        heartbeat()
        buffer += chunk
        for (;;) {
          const i = buffer.indexOf('\n\n')
          if (i < 0) break
          const line = buffer.slice(0, i)
          buffer = buffer.slice(i + 2)
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.channel === 'background:epoch') {
              const next = typeof event.payload?.epoch === 'string' ? event.payload.epoch : null
              const restarted = epoch !== null && next !== null && next !== epoch
              if (next) epoch = next
              if (restarted) receive('background:connection', { connected: true, restarted: true })
              continue
            }
            receive(event.channel, event.payload)
          } catch {}
        }
      })
      res.on('end', disconnected)
      res.on('error', disconnected)
      res.on('close', disconnected)
      active!.once('close', () => clearTimeout(deadline))
    })
    active.on('error', disconnected)
    active.once('close', () => clearTimeout(deadline))
    active.end()
  }
  const connect = () => {
    if (closed) return
    cancelQueued()
    releaseAttempt()
    releaseAttempt = () => {}
    clearTimeout(retry)
    retry = undefined
    generation++
    active?.destroy()
    connected = false
    connecting = true
    if (!remote) {
      startAttempt()
      return
    }
    cancelQueued = attempts.schedule(new URL(endpoint.url).origin, (release) => {
      releaseAttempt = release
      startAttempt()
    })
  }
  if (needsNetwork)
    offNetwork = monitor.subscribe((force) => {
      if (closed) return
      if (unavailable()) {
        generation++
        cancelQueued()
        releaseAttempt()
        releaseAttempt = () => {}
        connected = false
        connecting = false
        clearTimeout(retry)
        retry = undefined
        active?.destroy()
        report('network')
      } else if (!connected || force) {
        failures = 0
        connect()
      }
    })
  if (remote && policy.watchWake)
    offWake = policy.watchWake(() => {
      if (!closed && !connected && !connecting) {
        failures = 0
        connect()
      }
    })
  connect()
  return () => {
    closed = true
    generation++
    cancelQueued()
    releaseAttempt()
    releaseAttempt = () => {}
    offNetwork()
    offWake()
    clearTimeout(retry)
    active?.destroy()
  }
}
