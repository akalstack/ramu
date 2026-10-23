import {
  AUTH_SCHEME,
  decodeSocketFrame,
  encodeSocketFrame,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  SOCKET_PATH,
} from '@ramu/contracts'

/** What a platform's WebSocket must give back: text frames out, and a way to close. */
export interface SocketLike {
  send(text: string): void
  close(): void
}
export interface SocketHandlers {
  onopen(): void
  onmessage(text: string): void
  /** `status` is the HTTP status of a refused upgrade, when the platform reports it. */
  onclose(info: { status?: number }): void
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
  connectTimeoutMs?: number
  heartbeatMs?: number
  random?: () => number
}

export interface SocketInvokeOptions {
  operationKey?: string
  timeoutMs?: number
  signal?: AbortSignal
}

/** Shaped like a socket-level failure so `isTransportFailure` treats it as one: the outcome of the call is unknown. */
const lost = (message: string) => Object.assign(new Error(message), { code: 'ECONNRESET' })

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
  private beat: ReturnType<typeof setInterval> | undefined
  private lastHeard = 0
  private connectedAt = 0
  state: SocketState = 'closed'

  constructor(private readonly options: RuntimeSocketOptions) {}

  private set(state: SocketState) {
    if (this.state === state) return
    this.state = state
    this.options.onState?.(state)
  }

  private after(ms: number, work: () => void) {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      work()
    }, ms)
    this.timers.add(timer)
    return timer
  }

  start() {
    if (this.closed || this.socket) return
    this.set('connecting')
    const url = new URL(SOCKET_PATH, this.options.url)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const headers = {
      Authorization: `${AUTH_SCHEME} ${this.options.token}`,
      [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
    }
    const deadline = this.after(this.options.connectTimeoutMs ?? 10_000, () => socket.close())
    const socket: SocketLike = this.options.factory(url.toString(), headers, {
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
          this.connectedAt = Date.now()
          if (this.epoch !== null && this.epoch !== frame.epoch) this.options.onRestart?.()
          this.epoch = frame.epoch
          this.set('ready')
          this.startHeartbeat(socket)
        } else if (frame.t === 'event') this.options.onEvent(frame.channel, frame.payload)
        else if (frame.t === 'result') this.settle(frame.id, (call) => call.resolve(frame.value))
        else if (frame.t === 'error')
          this.settle(frame.id, (call) =>
            call.reject(Object.assign(new Error(frame.error), frame.status ? { status: frame.status } : {})),
          )
      },
      onclose: ({ status }) => {
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
        const base = Math.min(30_000, 1000 * 2 ** this.failures++)
        this.after(base / 2 + (this.options.random?.() ?? Math.random()) * (base / 2), () => this.start())
      },
    })
    this.socket = socket
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
    this.beat.unref?.()
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
    if (!socket || !this.ready) return Promise.reject(lost('The socket is not connected'))
    if (options.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const cleanup = () => {
        if (timer) {
          clearTimeout(timer)
          this.timers.delete(timer)
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
        resolve: (value) => (cleanup(), resolve(value)),
        reject: (error) => (cleanup(), reject(error)),
      })
      options.signal?.addEventListener('abort', onAbort, { once: true })
      timer = this.after(options.timeoutMs ?? 180_000, () => {
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
