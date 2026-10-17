import { encodeInvoke, PROTOCOL_HEADER, PROTOCOL_VERSION, isLoopbackHost } from '@ramu/contracts'
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
  private headers() {
    return { Authorization: `Bearer ${this.token}`, [PROTOCOL_HEADER]: String(PROTOCOL_VERSION) }
  }
  async invoke<M extends keyof RamuMethods>(
    method: M,
    ...args: Parameters<RamuMethods[M]>
  ): Promise<Awaited<ReturnType<RamuMethods[M]>>> {
    const controller = new AbortController()
    this.controllers.add(controller)
    const timer = setTimeout(() => controller.abort(), 45_000)
    try {
      const response = await this.fetcher(`${this.address}/invoke`, {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: encodeInvoke(method, args),
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
