// Node-side connection to a Ramu workspace server: request/response calls and a reconnecting event stream.
// Used by the Electron main process, the server CLI and, later, remote clients.
import { request as httpRequest, type RequestOptions } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { AUTH_SCHEME, PROTOCOL_HEADER, PROTOCOL_VERSION, encodeInvoke, type RuntimeEndpoint } from '@ramu/contracts'

export type { RuntimeEndpoint } from '@ramu/contracts'

/** Short per-profile socket path: unix socket paths are limited to about 100 bytes, so it lives in the temp directory. */
export function runtimeSocket(userData: string): string {
  return join(tmpdir(), `ramu-${process.getuid?.() ?? 'user'}-${createHash('sha256').update(userData).digest('hex').slice(0, 20)}.sock`)
}

/** A bare string is a unix socket path. */
export function toEndpoint(target: string | RuntimeEndpoint): RuntimeEndpoint {
  return typeof target === 'string' ? { kind: 'socket', path: target } : target
}

function prepare(target: string | RuntimeEndpoint, path: string, method: 'GET' | 'POST', extra: Record<string, string> = {}): { options: RequestOptions; send: typeof httpRequest } {
  const endpoint = toEndpoint(target)
  const headers: Record<string, string> = { [PROTOCOL_HEADER]: String(PROTOCOL_VERSION), ...extra }
  if (endpoint.kind === 'socket') return { options: { socketPath: endpoint.path, path, method, headers }, send: httpRequest }
  const url = new URL(endpoint.url)
  headers.Authorization = `${AUTH_SCHEME} ${endpoint.token}`
  return {
    options: { hostname: url.hostname.replace(/^\[|\]$/g, ''), port: url.port || (url.protocol === 'https:' ? 443 : 80), path: `${url.pathname.replace(/\/$/, '')}${path}`, method, headers },
    send: url.protocol === 'https:' ? httpsRequest : httpRequest,
  }
}

export function runtimeInvoke(target: string | RuntimeEndpoint, method: string, args: unknown[] = []): Promise<any> {
  return new Promise((resolve, reject) => {
    const { options, send } = prepare(target, '/invoke', 'POST', { 'Content-Type': 'application/json' })
    const req = send(options, (res) => {
      const chunks: Buffer[] = []; res.on('data', (c) => chunks.push(c)); res.on('error', reject)
      res.on('end', () => {
        if (res.statusCode === 401) return reject(new Error('The server rejected the access token'))
        if (res.statusCode === 429) return reject(new Error('Too many failed attempts; try again shortly'))
        try { const body = JSON.parse(Buffer.concat(chunks).toString()); body.error ? reject(new Error(body.error)) : resolve(body.value) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject); req.setTimeout(180000, () => req.destroy(new Error('Background service request timed out')))
    req.end(encodeInvoke(method, args))
  })
}

export function subscribeRuntime(target: string | RuntimeEndpoint, receive: (channel: string, payload: any) => void): () => void {
  let closed = false, retry: NodeJS.Timeout | undefined, active: ReturnType<typeof httpRequest> | undefined
  const connect = () => {
    if (closed) return
    const { options, send } = prepare(target, '/events', 'GET')
    active = send(options, (res) => {
      if (res.statusCode !== 200) { res.resume(); disconnected(); return }
      receive('background:connection', { connected: true })
      let buffer = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        buffer += chunk
        for (;;) { const i = buffer.indexOf('\n\n'); if (i < 0) break; const line = buffer.slice(0, i); buffer = buffer.slice(i + 2); if (!line.startsWith('data: ')) continue; try { const event = JSON.parse(line.slice(6)); receive(event.channel, event.payload) } catch {} }
      })
      res.on('end', disconnected); res.on('error', disconnected)
    })
    const disconnected = () => { if (closed || retry) return; receive('background:connection', { connected: false }); retry = setTimeout(() => { retry = undefined; connect() }, 1000) }
    active.on('error', disconnected); active.end()
  }
  connect()
  return () => { closed = true; clearTimeout(retry); active?.destroy() }
}
