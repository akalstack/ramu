import { PROTOCOL_HEADER, PROTOCOL_VERSION, RECOVERABLE_MUTATIONS, isLoopbackHost } from '@ramu/contracts'
import type { RamuMethods } from '@ramu/shared/api'
import { pushMessage, type PushArgs } from '@ramu/shared/pushChannels'

export class HostError extends Error {
  status: number
  ambiguous: boolean
  constructor(message: string, status = 0, ambiguous = false) {
    super(message)
    this.status = status
    this.ambiguous = ambiguous
  }
}
/**
 * The phone stopped this request on purpose: the app went to the background or the connection was replaced. Not a
 * failure to show; the request runs again when the connection resumes (an ambiguous send is reconciled by the outbox).
 */
export class SuspendedError extends HostError {}
/** A fresh key for one logical mutation: the host stores its result under it for ten minutes. */
export function operationKey(): string {
  const part = () =>
    Math.floor(Math.random() * 36 ** 6)
      .toString(36)
      .padStart(6, '0')
  return `${Date.now().toString(36)}-${part()}${part()}${part()}`
}
export function normalizeAddress(input: string, allowHttp = false): string {
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`)
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Enter an HTTP(S) origin: scheme, host and port, without credentials or a path.')
  if (url.protocol === 'http:' && !allowHttp && !isLoopbackHost(url.hostname))
    throw new Error('Allow HTTP only for a trusted private network.')
  return url.origin
}
export function needsHttpConsent(input: string): boolean {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`)
    return url.protocol === 'http:' && !isLoopbackHost(url.hostname)
  } catch {
    return false
  }
}
/** The host's one socket, registered by `socketTransport.ts`: it carries every call and every event for the phone. */
export interface HostSocket {
  state: string
  whenReady(timeoutMs?: number, signal?: AbortSignal): Promise<void>
  invoke(method: string, args: unknown[], options: { operationKey?: string; timeoutMs?: number }): Promise<unknown>
  /** Asks the host for on-demand channels (see `hostSubscription.ts`) until the returned function is called. */
  watch(channels: readonly string[], keys?: Record<string, readonly string[]>): () => void
  /** Hears the host's events and the socket's state changes until the returned function is called. */
  listen(listener: { event(channel: string, payload: unknown): void; state?(state: string): void }): () => void
}
let socketProvider: ((address: string, token: string) => HostSocket) | null = null
let closeSocket: ((address: string, token: string) => void) | undefined
let probeSocket: ((address: string, token: string, signal: AbortSignal) => Promise<boolean>) | undefined
export function registerSocketProvider(
  provider: typeof socketProvider,
  close?: (address: string, token: string) => void,
  probe?: typeof probeSocket,
) {
  socketProvider = provider
  closeSocket = close
  probeSocket = probe
}
const socketOf = (address: string, token: string): HostSocket => {
  if (!socketProvider) throw new HostError('This build cannot connect to a host. Update Ramu and try again.')
  return socketProvider(address, token)
}
/** Waiting for the socket fails the way an HTTP answer would have: a refused token or a host without a socket. */
function connectionError(error: unknown): HostError {
  const failure = error as { status?: number; message?: string }
  if (failure?.status === 401 || failure?.status === 426)
    return new HostError(
      failure.status === 401 ? 'Pairing was revoked. Pair this host again.' : 'Update Ramu on this host and try again.',
      failure.status,
    )
  return new HostError(
    error instanceof Error && (error as { notSent?: boolean }).notSent
      ? 'Host unreachable'
      : (failure?.message ?? 'Host unreachable'),
  )
}
export type Fetcher = typeof globalThis.fetch
export class HostClient {
  private streams = new Set<() => void>()
  private lifetime = new AbortController()
  readonly address: string
  private token: string
  private fetcher: Fetcher
  constructor(address: string, token: string, fetcher: Fetcher) {
    this.address = address
    this.token = token
    this.fetcher = (...args) => fetcher(...args)
  }
  close() {
    if (this.lifetime.signal.aborted) return
    this.lifetime.abort()
    closeSocket?.(this.address, this.token)
    for (const end of this.streams) end()
    this.streams.clear()
  }
  /** The token requests use; renewal swaps it after the new one is saved. */
  currentToken() {
    return this.token
  }
  useToken(token: string) {
    this.token = token
  }
  get fetch(): Fetcher {
    return this.fetcher
  }
  async invoke<M extends keyof RamuMethods>(
    method: M,
    ...args: Parameters<RamuMethods[M]>
  ): Promise<Awaited<ReturnType<RamuMethods[M]>>> {
    // The one place a host's answer takes its method's declared type; the host validated the call and built the result.
    type Result = Awaited<ReturnType<RamuMethods[M]>>
    if (!RECOVERABLE_MUTATIONS.has(method)) return (await this.call(method, args)) as Result
    // One key across the attempts: a host that already ran the action returns its first result instead of running it again.
    const key = operationKey()
    for (let attempt = 0; ; attempt++) {
      try {
        return (await this.call(method, args, key)) as Result
      } catch (error) {
        if (this.lifetime.signal.aborted || !(error instanceof HostError) || !error.ambiguous || attempt >= 2)
          throw error
        await new Promise((resolve) => setTimeout(resolve, 500 * 3 ** attempt))
      }
    }
  }
  /** Native socket/fetch promises may outlive suspension; do not hold resume behind their timeout. */
  private untilClosed<T>(request: Promise<T>): Promise<T> {
    const signal = this.lifetime.signal
    return new Promise((resolve, reject) => {
      const abort = () => reject(new SuspendedError('Connection suspended. Check delivery before retrying.', 0, true))
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
      request.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
  }
  /**
   * The platform socket cannot say why an upgrade failed, so a socket that never became ready is checked once over
   * HTTP, which can: a revoked token is reported as such, and a reachable host with a blocked socket says so.
   */
  private async diagnose(error: unknown): Promise<HostError> {
    const known = connectionError(error)
    if (known.status === 401 || known.status === 426 || this.lifetime.signal.aborted) return known
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<HostError>((resolve) => {
      timer = setTimeout(() => {
        controller.abort()
        resolve(known)
      }, 8000)
    })
    const check = async (): Promise<HostError> => {
      try {
        const response = await this.fetcher(`${this.address}/session`, {
          headers: { Authorization: `Bearer ${this.token}`, [PROTOCOL_HEADER]: String(PROTOCOL_VERSION) },
          signal: controller.signal,
        })
        if (response.status === 401) return new HostError('Pairing was revoked. Pair this host again.', 401)
        if (response.ok)
          return new HostError(
            'The host is reachable but this network blocks live connections. Try another network or route.',
          )
      } catch {}
      return known
    }
    try {
      return await Promise.race([check(), timeout])
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }

  private async call(method: string, args: unknown[], operationKey?: string): Promise<unknown> {
    if (this.lifetime.signal.aborted) throw new SuspendedError('Connection suspended before sending.')
    // One socket carries every call. There is no second transport: a call waits briefly for the socket, and a refused
    // token or a host without a socket is reported as that. A call lost after it was sent has an unknown outcome.
    const socket = socketOf(this.address, this.token)
    for (let attempt = 0; ; attempt++) {
      try {
        await this.untilClosed(socket.whenReady(15_000))
      } catch (error) {
        if (error instanceof HostError) throw error
        throw await this.diagnose(error)
      }
      try {
        return await this.untilClosed(
          socket.invoke(method, args, { ...(operationKey ? { operationKey } : {}), timeoutMs: 45_000 }),
        )
      } catch (error) {
        if (error instanceof HostError) throw error
        const failure = error as { notSent?: boolean; status?: number; code?: string }
        // Never sent: the socket dropped between ready and send, so one more wait cannot duplicate the action.
        if (failure.notSent && attempt < 1) continue
        if (failure.notSent) throw new HostError('Host unreachable')
        if (failure.code === 'ECONNRESET' || !(error instanceof Error))
          throw new HostError(
            'Connection interrupted. The host may have received this action. Refresh and check before retrying.',
            0,
            true,
          )
        throw new HostError(error.message, failure.status ?? 0)
      }
    }
  }
  /** Frequent channels only one screen reads are taken while that screen is open, not all the time. */
  watch(channels: readonly string[], keys?: Record<string, readonly string[]>): () => void {
    return socketOf(this.address, this.token).watch(channels, keys)
  }
  /**
   * Delivers the host's events from its socket until the socket drops or `signal` aborts, running `ready` (hydration)
   * with the listener already attached so nothing that changes during the snapshot is missed. The socket reconnects on
   * its own; the caller starts another stream, and hydrates again, when this one ends.
   */
  async stream(receive: (...args: PushArgs) => void, ready: () => Promise<void>, signal: AbortSignal) {
    if (signal.aborted) return
    const socket = socketOf(this.address, this.token)
    try {
      await socket.whenReady(15_000, signal)
    } catch (error) {
      if (signal.aborted) return
      throw await this.diagnose(error)
    }
    if (signal.aborted) return
    let gone!: () => void
    const dropped = new Promise<void>((resolve) => (gone = resolve))
    const abort = () => gone()
    signal.addEventListener('abort', abort, { once: true })
    this.streams.add(abort)
    const stop = socket.listen({
      event: (channel, payload) => {
        // A channel this app does not know, or a payload that cannot be what it carries, is dropped here.
        const message = pushMessage(channel, payload)
        if (message && !signal.aborted) receive(...([message.channel, message.payload] as PushArgs))
      },
      state: (state) => {
        if (state !== 'ready') gone()
      },
    })
    let hydrationError: unknown
    void ready().catch((error) => {
      hydrationError = error
      gone()
    })
    try {
      await dropped
      // History reads may still be pending on the dead route; their rejection is already handled above.
      if (hydrationError) throw hydrationError
    } finally {
      stop()
      this.streams.delete(abort)
      signal.removeEventListener('abort', abort)
    }
    if (!signal.aborted) throw new HostError('The host disconnected')
  }
}

/** An identity response alone is insufficient: the same address must also carry the app connection. */
export async function checkHostConnection(
  address: string,
  token: string,
  fetcher: Fetcher,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return false
  if (probeSocket) return probeSocket(address, token, signal)
  const probe = new HostClient(address, token, fetcher)
  const close = () => probe.close()
  signal.addEventListener('abort', close, { once: true })
  try {
    const info = await probe.invoke('background.status')
    return info.protocol === 1
  } finally {
    signal.removeEventListener('abort', close)
    close()
  }
}

/** Initial status reads have a short deadline independent of full history synchronization or native fetch cancellation. */
export async function readConnectionStatus(client: HostClient, signal: AbortSignal) {
  if (signal.aborted) {
    client.close()
    throw new SuspendedError('Connection suspended before sending.')
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: () => void = () => {}
  const deadline = new Promise<never>((_resolve, reject) => {
    abort = () => {
      client.close()
      reject(new SuspendedError('Connection suspended before sending.'))
    }
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => {
      client.close()
      reject(new HostError('The host did not finish connecting. Trying again.'))
    }, 8000)
  })
  try {
    return await Promise.race([client.invoke('background.status'), deadline])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}
