import { encodeInvoke, PROTOCOL_HEADER, PROTOCOL_VERSION, RECOVERABLE_MUTATIONS, isLoopbackHost } from '@ramu/contracts'
import type { PushEvents, RamuMethods } from '@ramu/shared/api'

export class HostError extends Error {
  status: number
  ambiguous: boolean
  constructor(message: string, status = 0, ambiguous = false) {
    super(message)
    this.status = status
    this.ambiguous = ambiguous
  }
}
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
/** Handles arbitrary chunk boundaries, CRLF, comments and multi-line SSE data. */
export function needsHttpConsent(input: string): boolean {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`)
    return url.protocol === 'http:' && !isLoopbackHost(url.hostname)
  } catch {
    return false
  }
}
export class EventParser {
  private buffer = ''
  private receive: (channel: keyof PushEvents, payload: any) => void
  constructor(receive: (channel: keyof PushEvents, payload: any) => void) {
    this.receive = receive
  }
  push(text: string) {
    this.buffer += text
    if (this.buffer.length > 20_000_000) throw new Error('Event stream frame is too large')
    let match: RegExpExecArray | null
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const block = this.buffer.slice(0, match.index)
      this.buffer = this.buffer.slice(match.index + match[0].length)
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n')
      if (!data) continue
      const event = JSON.parse(data)
      if (typeof event.channel !== 'string' || !('payload' in event)) throw new Error('Invalid host event')
      this.receive(event.channel, event.payload)
    }
  }
}
/** The opt-in call socket for a host, registered by `socketTransport.ts`; absent in tests and when sockets are off. */
interface CallSocket {
  state: string
  invoke(method: string, args: unknown[], options: { operationKey?: string; timeoutMs?: number }): Promise<unknown>
}
let socketProvider: ((address: string, token: string) => CallSocket | null) | null = null
export function registerSocketProvider(provider: typeof socketProvider) {
  socketProvider = provider
}
export type Fetcher = typeof globalThis.fetch
export class HostClient {
  private controllers = new Set<AbortController>()
  readonly address: string
  private token: string
  private fetcher: Fetcher
  constructor(address: string, token: string, fetcher: Fetcher) {
    this.address = address
    this.token = token
    this.fetcher = (...args) => fetcher(...args)
  }
  close() {
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
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
  private headers() {
    return { Authorization: `Bearer ${this.token}`, [PROTOCOL_HEADER]: String(PROTOCOL_VERSION) }
  }
  private operationKeys: Promise<boolean> | undefined
  /** Whether the host advertises `operation-keys`, read once from its status. A host that does not say never gets retries. */
  private supportsOperationKeys(): Promise<boolean> {
    this.operationKeys ??= this.call('background.status', [])
      .then((status: { capabilities?: string[] }) => !!status?.capabilities?.includes('operation-keys'))
      .catch(() => false)
    return this.operationKeys
  }
  async invoke<M extends keyof RamuMethods>(
    method: M,
    ...args: Parameters<RamuMethods[M]>
  ): Promise<Awaited<ReturnType<RamuMethods[M]>>> {
    if (!RECOVERABLE_MUTATIONS.has(method) || !(await this.supportsOperationKeys())) return this.call(method, args)
    // One key across the attempts: a host that already ran the action returns its first result instead of running it again.
    const key = operationKey()
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.call(method, args, key)
      } catch (error) {
        if (!(error instanceof HostError) || !error.ambiguous || attempt >= 2) throw error
        await new Promise((resolve) => setTimeout(resolve, 500 * 3 ** attempt))
      }
    }
  }
  private async call(method: string, args: unknown[], operationKey?: string): Promise<any> {
    // Opt-in socket, used only while ready. A call that was never sent falls back to HTTP; one that was sent and lost
    // has an unknown outcome and is reported as such, exactly as a lost HTTP reply is.
    const socket = socketProvider?.(this.address, this.token)
    if (socket?.state === 'ready') {
      try {
        return await socket.invoke(method, args, { ...(operationKey ? { operationKey } : {}), timeoutMs: 45_000 })
      } catch (error) {
        const failure = error as { notSent?: boolean; status?: number; code?: string }
        if (!failure.notSent) {
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
    const controller = new AbortController()
    this.controllers.add(controller)
    const timer = setTimeout(() => controller.abort(), 45_000)
    try {
      const response = await this.fetcher(`${this.address}/invoke`, {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: encodeInvoke(method, args, operationKey),
        signal: controller.signal,
      })
      const text = await response.text()
      let result: any
      try {
        result = text ? JSON.parse(text) : {}
      } catch {
        throw new HostError('The host returned an invalid response. Refresh before retrying.', response.status, true)
      }
      if (!response.ok || result.error)
        throw new HostError(
          result.error ||
            (response.status === 401
              ? 'Pairing was revoked. Pair this host again.'
              : `Host request failed (${response.status})`),
          response.status,
        )
      return result.value
    } catch (error) {
      if (error instanceof HostError) throw error
      throw new HostError(
        'Connection interrupted. The host may have received this action. Refresh and check before retrying.',
        0,
        true,
      )
    } finally {
      clearTimeout(timer)
      this.controllers.delete(controller)
    }
  }
  async stream(
    receive: (channel: keyof PushEvents, payload: any) => void,
    ready: () => Promise<void>,
    signal: AbortSignal,
  ) {
    if (signal.aborted) return
    const controller = new AbortController()
    this.controllers.add(controller)
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort)
    const timeout = setTimeout(abort, 15_000)
    let watchdog: ReturnType<typeof setTimeout> | undefined
    try {
      const response = await this.fetcher(`${this.address}/events`, {
        headers: this.headers(),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!response.ok)
        throw new HostError(
          response.status === 401
            ? 'Pairing was revoked. Pair again.'
            : `Event stream unavailable (${response.status})`,
          response.status,
        )
      if (!response.body) throw new Error('Streaming is unavailable on this device')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const parser = new EventParser(receive)
      // Begin reading before hydration: changes during the snapshot are buffered by the store.
      let hydrationError: unknown
      const hydration = ready().catch((error) => {
        hydrationError = error
        controller.abort()
      })
      try {
        while (!signal.aborted) {
          clearTimeout(watchdog)
          watchdog = setTimeout(abort, 65_000)
          const chunk = await reader.read()
          if (chunk.done) break
          parser.push(decoder.decode(chunk.value, { stream: true }))
        }
        await hydration
        if (hydrationError) throw hydrationError
      } finally {
        await reader.cancel().catch(() => {})
        await hydration.catch(() => {})
      }
      if (!signal.aborted) throw new HostError('The host disconnected')
    } finally {
      clearTimeout(timeout)
      clearTimeout(watchdog)
      signal.removeEventListener('abort', abort)
      this.controllers.delete(controller)
    }
  }
}
