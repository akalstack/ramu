// Minimal JSON-RPC 2.0 over stdio with Content-Length framing, as used by the Language Server Protocol.
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

export class RpcError extends Error {
  constructor(message: string, readonly code: number) { super(message) }
}
export const REQUEST_CANCELLED = -32800

interface Message { jsonrpc: '2.0'; id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string } }

/** Splits a byte stream into messages; handles headers and bodies that arrive in separate or merged chunks. */
export class MessageReader {
  private buffer = Buffer.alloc(0)
  constructor(private onMessage: (message: Message) => void) {}
  push(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const end = this.buffer.indexOf('\r\n\r\n')
      if (end < 0) return
      const length = /Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, end).toString('ascii'))?.[1]
      // A header block without a length cannot be resynchronized; drop it and keep reading.
      if (!length) { this.buffer = this.buffer.subarray(end + 4); continue }
      const total = end + 4 + Number(length)
      if (this.buffer.length < total) return
      const body = this.buffer.subarray(end + 4, total).toString('utf8')
      this.buffer = this.buffer.subarray(total)
      try { this.onMessage(JSON.parse(body) as Message) } catch { /* ignore a malformed message */ }
    }
  }
}

export class Connection {
  private nextId = 0
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  private notifications = new Map<string, (params: any) => void>()
  private requests = new Map<string, (params: any) => unknown>()
  closed = false
  onClose: (() => void) | null = null

  constructor(private child: ChildProcessWithoutNullStreams, private defaultTimeoutMs = 15_000) {
    const reader = new MessageReader((message) => this.dispatch(message))
    child.stdout.on('data', (chunk: Buffer) => reader.push(chunk))
    child.stdin.on('error', () => {})
    const finish = () => {
      if (this.closed) return
      this.closed = true
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new RpcError('The language server stopped.', -32099)) }
      this.pending.clear()
      this.onClose?.()
    }
    child.on('exit', finish); child.on('error', finish)
  }

  onNotification(method: string, handler: (params: any) => void) { this.notifications.set(method, handler) }
  /** Handles requests the server sends to the client, such as `workspace/configuration`. */
  onRequest(method: string, handler: (params: any) => unknown) { this.requests.set(method, handler) }

  private write(message: Message) {
    if (this.closed) return
    const body = JSON.stringify(message)
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  }

  private dispatch(message: Message) {
    if (message.method !== undefined && message.id !== undefined) {
      const handler = this.requests.get(message.method)
      let result: unknown = null
      try { result = handler ? handler(message.params) : null } catch { result = null }
      this.write({ jsonrpc: '2.0', id: message.id, result })
    } else if (message.method !== undefined) {
      this.notifications.get(message.method)?.(message.params)
    } else if (typeof message.id === 'number') {
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id); clearTimeout(entry.timer)
      if (message.error) entry.reject(new RpcError(message.error.message, message.error.code)); else entry.resolve(message.result)
    }
  }

  notify(method: string, params?: unknown) { this.write({ jsonrpc: '2.0', method, params }) }

  /** Rejects when the server stops, the call times out, or `signal` aborts (which also tells the server to stop working). */
  request<T = unknown>(method: string, params?: unknown, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
    if (this.closed) return Promise.reject(new RpcError('The language server is not running.', -32099))
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      const cancel = () => {
        if (!this.pending.has(id)) return
        this.notify('$/cancelRequest', { id })
        const entry = this.pending.get(id)!
        this.pending.delete(id); clearTimeout(entry.timer); entry.reject(new RpcError('Request cancelled', REQUEST_CANCELLED))
      }
      const timer = setTimeout(() => { cancel() }, options.timeoutMs ?? this.defaultTimeoutMs)
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      options.signal?.addEventListener('abort', cancel, { once: true })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  dispose() { this.child.kill() }
}
