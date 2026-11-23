import {
  AUTH_SCHEME,
  decodeSocketFrame,
  encodeSocketFrame,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  SOCKET_PATH,
} from '@ramu/contracts'
import { checkRpcResult } from '@ramu/shared/rpcResults'
import { RPC_RESULTS } from '@ramu/shared/rpcResults.generated'

/** What a platform's WebSocket must give back: text frames out, and a way to close. */
export interface SocketLike {
  send(text: string): void
  close(): void
}
export interface SocketHandlers {
  onopen(): void
  onmessage(text: string): void
  /** `status` is the HTTP status of a refused upgrade and `code` the connection error (ENOENT, ECONNREFUSED), when the platform reports them. */
  onclose(info: { status?: number; code?: string }): void
}
/** Opens one socket with the given headers. Platform adapters live with the platform: Node here, React Native in the phone. */
export type SocketFactory = (url: string, headers: Record<string, string>, handlers: SocketHandlers) => SocketLike

/**
 * `connecting` and `ready` are the transport's own readiness; whether the app has finished synchronizing is a separate
 * question the caller answers. `rejected` (credentials refused) and `unsupported` (no WebSocket on this host) stop
 * reconnecting: neither is cured by waiting, and neither may be hidden by falling back silently.
 */
export type SocketState = 'connecting' | 'ready' | 'closed' | 'rejected' | 'unsupported'

export interface RuntimeSocketOptions {
  /** The host's base URL, http(s). */
  url: string
  token: string
  factory: SocketFactory
  onEvent(channel: string, payload: unknown): void
  onState?(state: SocketState): void
  /** The host's run identity changed: it restarted and every cursor held is void. */
  onRestart?(): void
  /** The run an earlier socket to this host last saw, when this one replaces it, so a restart in between is still told. */
  epoch?: string | null
  /**
   * Ask the host to hold back terminal output this client has not processed, and acknowledge each `term:data` chunk
   * once `onEvent` has returned. A `term:behind` event then means chunks were withheld: fetch `term.snapshot(id, since)`.
   */
  flowControl?: boolean
  /** False asks the host for calls only, for a client whose events already arrive on another stream. */
  events?: boolean
  /** Extra upgrade headers (for example the desktop's presence port). */
  headers?: Record<string, string>
  /** Longest wait between reconnects; the local connection to this machine's own service keeps it short. */
  maxBackoffMs?: number
  connectTimeoutMs?: number
  heartbeatMs?: number
  random?: () => number
}

export interface SocketSubscription {
  channels: string[]
  keys?: Record<string, string[]>
  skip?: Record<string, string[]>
  everything?: boolean
}
export interface SocketInvokeOptions {
  operationKey?: string
  timeoutMs?: number
  signal?: AbortSignal
}

/** Shaped like a socket-level failure so `isTransportFailure` treats it as one: the outcome of the call is unknown. */
const lost = (message: string, notSent = false) =>
  Object.assign(new Error(message), { code: 'ECONNRESET', ...(notSent ? { notSent: true } : {}) })

/**
 * One authenticated WebSocket to a host, kept connected with bounded, jittered reconnects. Calls are matched to answers by
 * a correlation id that has nothing to do with an `operationKey`: after a lost connection a pending call is settled as an
 * unknown outcome (a transport failure), and only a call that carries an operation key may be retried safely.
 */
export class RuntimeSocket {
  private socket: SocketLike | null = null
  private ready = false
  private closed = false
  private failures = 0
  private epoch: string | null = null
  private nextId = 1
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private subscription: SocketSubscription | null = null
  private beat: ReturnType<typeof setInterval> | undefined
  private lastHeard = 0
  private connectedAt = 0
  private suspended = false
  private everReady = false
  private lastCode: string | undefined
  private readonly waiters = new Set<() => void>()
  state: SocketState = 'closed'

  constructor(private readonly options: RuntimeSocketOptions) {
    this.epoch = options.epoch ?? null
  }

  /** The host run this socket last connected to, or null before its first connection. */
  get runId(): string | null {
    return this.epoch
  }

  private set(state: SocketState) {
    if (this.state === state) return
    this.state = state
    this.options.onState?.(state)
    for (const wake of [...this.waiters]) wake()
  }

  private after(ms: number, work: () => void, unref = false) {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      work()
    }, ms)
    // A pooled socket's reconnect must not keep a client process alive; a pending call keeps its own timer.
    if (unref) (timer as { unref?: () => void }).unref?.()
    this.timers.add(timer)
    return timer
  }

  start() {
    if (this.closed || this.suspended || this.socket) return
    this.set('connecting')
    // A local service is reached over its unix socket (`ws+unix:///path.sock`); a remote host over ws(s).
    let target: string
    if (this.options.url.startsWith('ws+unix:')) target = `${this.options.url}:${SOCKET_PATH}`
    else {
      const url = new URL(SOCKET_PATH, this.options.url)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      if (this.options.events === false) url.searchParams.set('events', 'none')
      target = url.toString()
    }
    const headers = {
      ...this.options.headers,
      Authorization: `${AUTH_SCHEME} ${this.options.token}`,
      [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
    }
    const deadline = this.after(this.options.connectTimeoutMs ?? 10_000, () => socket.close())
    const socket: SocketLike = this.options.factory(target, headers, {
      onopen: () => {
        this.lastHeard = Date.now()
      },
      onmessage: (text) => {
        const frame = decodeSocketFrame(text, 'server')
        if (!frame) return
        this.lastHeard = Date.now()
        if (frame.t === 'ready') {
          clearTimeout(deadline)
          this.timers.delete(deadline)
          this.ready = true
          this.everReady = true
          this.connectedAt = Date.now()
          if (this.epoch !== null && this.epoch !== frame.epoch) this.options.onRestart?.()
          this.epoch = frame.epoch
          this.set('ready')
          this.startHeartbeat(socket)
          // A new connection starts unfiltered; the interest the caller declared is restored before it matters.
          if (this.subscription) void this.sendSubscription(this.subscription).catch(() => {})
        } else if (frame.t === 'event') {
          this.options.onEvent(frame.channel, frame.payload)
          if (this.options.flowControl && frame.channel === 'term:data') this.acknowledge(socket, frame.payload)
        } else if (frame.t === 'result') this.settle(frame.id, (call) => call.resolve(frame.value))
        else if (frame.t === 'error')
          this.settle(frame.id, (call) =>
            call.reject(Object.assign(new Error(frame.error), frame.status ? { status: frame.status } : {})),
          )
      },
      onclose: ({ status, code }) => {
        this.lastCode = code
        clearTimeout(deadline)
        this.timers.delete(deadline)
        if (this.socket !== socket) return
        this.socket = null
        this.ready = false
        clearInterval(this.beat)
        for (const [id, call] of this.pending) {
          this.pending.delete(id)
          call.reject(lost('Connection lost before the host answered'))
        }
        if (this.closed) return
        if (status === 401 || status === 403) return this.set('rejected')
        if (status === 404 || status === 400 || status === 426) return this.set('unsupported')
        // A connection that held for a while was healthy; a flapping host keeps its growing delay.
        if (this.connectedAt && Date.now() - this.connectedAt >= 30_000) this.failures = 0
        this.connectedAt = 0
        this.set('closed')
        const base = Math.min(this.options.maxBackoffMs ?? 30_000, 1000 * 2 ** this.failures++)
        this.after(base / 2 + (this.options.random?.() ?? Math.random()) * (base / 2), () => this.start(), true)
      },
    })
    this.socket = socket
  }

  /** Tells the host this much of a terminal's output has been handled, in the characters of its chunks. */
  private acknowledge(socket: SocketLike, payload: unknown) {
    const { id, data } = (payload ?? {}) as { id?: unknown; data?: unknown }
    if (typeof id !== 'string' || typeof data !== 'string' || !data.length) return
    try {
      socket.send(encodeSocketFrame({ t: 'ack', id, bytes: data.length }))
    } catch {
      // A socket that cannot send is closing; the reconnect resynchronizes from the terminal's cursor.
    }
  }

  private startHeartbeat(socket: SocketLike) {
    const every = this.options.heartbeatMs ?? 25_000
    clearInterval(this.beat)
    this.beat = setInterval(() => {
      if (Date.now() - this.lastHeard > every * 2.5) {
        socket.close()
        return
      }
      socket.send(encodeSocketFrame({ t: 'ping' }))
    }, every)
    ;(this.beat as { unref?: () => void }).unref?.()
  }

  private settle(id: number, finish: (call: NonNullable<ReturnType<typeof this.pending.get>>) => void) {
    const call = this.pending.get(id)
    if (!call) return
    this.pending.delete(id)
    finish(call)
  }

  /** Rejects at once when the socket is not ready, so the caller can use HTTP instead of waiting on a connection. */
  invoke(method: string, args: unknown[] = [], options: SocketInvokeOptions = {}): Promise<unknown> {
    const socket = this.socket
    if (!socket || !this.ready) return Promise.reject(lost('The socket is not connected', true))
    if (options.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const wait: { timer?: ReturnType<typeof setTimeout> } = {}
      const cleanup = () => {
        if (wait.timer) {
          clearTimeout(wait.timer)
          this.timers.delete(wait.timer)
        }
        options.signal?.removeEventListener('abort', onAbort)
      }
      // Aborting the wait does not stop the work on the host; the call's outcome stays unknown.
      const onAbort = () => {
        this.pending.delete(id)
        cleanup()
        reject(new DOMException('Aborted', 'AbortError'))
      }
      this.pending.set(id, {
        resolve: (value) => {
          cleanup()
          // The answer must have the shape the method declares; a host on another version may not.
          try {
            checkRpcResult(RPC_RESULTS, method, value)
          } catch (error) {
            reject(error)
            return
          }
          resolve(value)
        },
        reject: (error) => (cleanup(), reject(error)),
      })
      options.signal?.addEventListener('abort', onAbort, { once: true })
      wait.timer = this.after(options.timeoutMs ?? 180_000, () => {
        this.pending.delete(id)
        cleanup()
        reject(lost('Background service request timed out'))
      })
      try {
        socket.send(
          encodeSocketFrame({
            t: 'invoke',
            id,
            method,
            args,
            ...(options.operationKey ? { operationKey: options.operationKey } : {}),
          }),
        )
      } catch (error) {
        this.pending.delete(id)
        cleanup()
        reject(lost(error instanceof Error ? error.message : 'The socket could not send'))
      }
    })
  }

  private sendSubscription(subscription: SocketSubscription) {
    const socket = this.socket
    if (!socket || !this.ready) return Promise.reject(lost('The socket is not connected', true))
    const id = this.nextId++
    return new Promise<unknown>((resolve, reject) => {
      // A host that does not know `subscribe` never answers; the caller must not wait forever.
      const timer = this.after(10_000, () => {
        this.pending.delete(id)
        reject(lost('The host did not answer the subscription'))
      })
      this.pending.set(id, {
        resolve: (value) => (clearTimeout(timer), this.timers.delete(timer), resolve(value)),
        reject: (error) => (clearTimeout(timer), this.timers.delete(timer), reject(error)),
      })
      try {
        socket.send(
          encodeSocketFrame({
            t: 'subscribe',
            id,
            ...subscription,
            ...(this.options.flowControl ? { flow: true } : {}),
          }),
        )
      } catch (error) {
        this.pending.delete(id)
        reject(lost(error instanceof Error ? error.message : 'The socket could not send'))
      }
    })
  }

  /**
   * Narrows the events this connection delivers to `channels` and, for resource channels (agent transcripts, terminals),
   * to the listed ids. Replaces any earlier subscription, and is restored after a reconnect. Without a subscription every
   * event arrives, as on the SSE stream.
   */
  subscribe(
    channels: string[],
    keys?: Record<string, string[]>,
    skip?: Record<string, string[]>,
    everything?: boolean,
  ): Promise<unknown> {
    this.subscription = {
      channels,
      ...(keys ? { keys } : {}),
      ...(skip ? { skip } : {}),
      ...(everything ? { everything } : {}),
    }
    return this.ready ? this.sendSubscription(this.subscription) : Promise.resolve()
  }

  /**
   * Resolves once the host has said `ready`. Rejects at once when the credentials were refused or the host has no
   * socket (neither is cured by waiting), and after `timeoutMs` (or an abort) when the connection never completes.
   */
  whenReady(timeoutMs = 10_000, signal?: AbortSignal, options: { failFast?: boolean } = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const wait: { timer?: ReturnType<typeof setTimeout> } = {}
      const finish = (error?: Error) => {
        this.waiters.delete(check)
        if (wait.timer) clearTimeout(wait.timer)
        signal?.removeEventListener('abort', onAbort)
        error ? reject(error) : resolve()
      }
      const check = () => {
        if (this.ready) finish()
        else if (this.state === 'rejected')
          finish(Object.assign(new Error('The server rejected the access token'), { status: 401 }))
        else if (this.state === 'unsupported')
          finish(
            Object.assign(new Error('Cannot connect to this host. Restart Ramu on the host and try again.'), {
              status: 426,
            }),
          )
        else if (this.closed) finish(lost('The connection was closed', true))
        // A one-shot caller (the CLI, the app starting its service) wants to know at once that nothing is listening.
        else if (options.failFast && !this.everReady && this.state === 'closed')
          finish(
            Object.assign(lost('Could not connect to the service', true), { code: this.lastCode ?? 'ECONNREFUSED' }),
          )
      }
      const onAbort = () => finish(new DOMException('Aborted', 'AbortError'))
      if (signal?.aborted) return onAbort()
      signal?.addEventListener('abort', onAbort, { once: true })
      wait.timer = setTimeout(() => finish(lost('The host did not answer in time', true)), timeoutMs)
      this.waiters.add(check)
      check()
    })
  }

  /** Drops the connection and stops reconnecting until `resume`, for a device with no usable network. */
  suspend() {
    this.suspended = true
    this.drop()
  }

  /**
   * Reconnects now, forgetting earlier failures: the network came back or the computer woke. An established connection
   * is left alone unless `force` says it may be stale (the device slept without its addresses changing).
   */
  resume(force = false) {
    if (this.closed) return
    this.suspended = false
    this.failures = 0
    if (this.ready && !force) return
    this.drop()
    this.start()
  }

  private drop() {
    const socket = this.socket
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    clearInterval(this.beat)
    if (!socket) return
    this.socket = null
    this.ready = false
    socket.close()
    for (const [id, call] of this.pending) {
      this.pending.delete(id)
      call.reject(lost('Connection lost before the host answered'))
    }
    this.set('closed')
  }

  close() {
    this.closed = true
    clearInterval(this.beat)
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    const socket = this.socket
    this.socket = null
    this.ready = false
    socket?.close()
    for (const [id, call] of this.pending) {
      this.pending.delete(id)
      call.reject(lost('The connection was closed'))
    }
    this.set('closed')
  }
}
