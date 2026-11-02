// Hands a decrypted Link stream to the host's ordinary remote server through an in-memory connection, so pairing,
// renewal, identity and the socket are authenticated and limited exactly as for a device on the network.
import { request as httpRequest, type Server } from 'node:http'
import { duplexPair, type Duplex } from 'node:stream'
import WebSocket from 'ws'
import { MAX_REQUEST_BYTES } from '@ramu/contracts'
import type { LinkRequest, LinkResponse } from '@ramu/shared/link/protocol'

/** Only what the host's endpoints read; a browser origin or a spoofed forwarding header never reaches them. */
const FORWARDED = new Set(['authorization', 'content-type', 'x-ramu-protocol', 'accept'])
const RETURNED = new Set(['content-type', 'cache-control', 'retry-after', 'x-ramu-device-role', 'x-ramu-token-expires'])
const PATH = /^\/[A-Za-z0-9\-._~/%]*(\?[A-Za-z0-9\-._~%&=+]*)?$/

export interface BridgeStream {
  /** One message for the device. */
  send(message: Uint8Array): void
  close(): void
}
export interface Bridge {
  /** A later message from the device (socket text frames). */
  message(bytes: Uint8Array): void
  close(): void
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function parseLinkRequest(bytes: Uint8Array): LinkRequest | null {
  try {
    const value = JSON.parse(decoder.decode(bytes)) as Partial<LinkRequest> & { method?: unknown; body?: unknown }
    if (!value || typeof value !== 'object' || typeof value.path !== 'string' || !PATH.test(value.path)) return null
    const headers: Record<string, string> = {}
    for (const [key, header] of Object.entries((value.headers as Record<string, unknown>) ?? {}))
      if (FORWARDED.has(key.toLowerCase()) && typeof header === 'string' && header.length <= 8192)
        headers[key.toLowerCase()] = header
    if (value.kind === 'socket') return { kind: 'socket', path: value.path, headers }
    if (value.kind !== 'http' || (value.method !== 'GET' && value.method !== 'POST')) return null
    if (value.body !== undefined && (typeof value.body !== 'string' || value.body.length > 64 * 1024)) return null
    return {
      kind: 'http',
      method: value.method,
      path: value.path,
      headers,
      ...(typeof value.body === 'string' ? { body: value.body } : {}),
    }
  } catch {
    return null
  }
}

/** One in-memory connection into `server`, named `peer` so per-peer limits treat each Link account separately. */
function connectInto(server: Server, peer: string): Duplex {
  const [client, side] = duplexPair()
  for (const end of [client, side] as (Duplex & Record<string, unknown>)[]) {
    end.setTimeout = () => end
    end.setNoDelay = () => end
    end.setKeepAlive = () => end
  }
  Object.defineProperty(side, 'remoteAddress', { value: peer })
  server.emit('connection', side)
  return client
}

const reply = (stream: BridgeStream, response: LinkResponse) => stream.send(encoder.encode(JSON.stringify(response)))

export function bridge(server: Server, peer: string, request: LinkRequest, stream: BridgeStream): Bridge {
  if (request.kind === 'http') {
    const outgoing = httpRequest(
      {
        method: request.method,
        path: request.path,
        headers: { ...request.headers, host: 'link' },
        createConnection: () => connectInto(server, peer),
      },
      (response) => {
        let size = 0
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_REQUEST_BYTES) response.destroy()
          else chunks.push(chunk)
        })
        response.on('end', () => {
          const headers: Record<string, string> = {}
          for (const [key, value] of Object.entries(response.headers))
            if (RETURNED.has(key) && typeof value === 'string') headers[key] = value
          reply(stream, { status: response.statusCode ?? 502, headers, body: Buffer.concat(chunks).toString() })
          stream.close()
        })
        response.on('error', () => stream.close())
      },
    )
    outgoing.on('error', () => stream.close())
    outgoing.end(request.body)
    return { message: () => {}, close: () => outgoing.destroy() }
  }

  const ws = new WebSocket(`ws://link${request.path}`, {
    headers: request.headers,
    maxPayload: MAX_REQUEST_BYTES,
    // The record layer already carries every byte once; compressing inside it saves nothing on an in-memory hop.
    perMessageDeflate: false,
    createConnection: () => connectInto(server, peer) as never,
  })
  let open = false
  ws.on('open', () => {
    open = true
    reply(stream, { status: 101, headers: {} })
  })
  ws.on('unexpected-response', (_request, response) => {
    reply(stream, { status: response.statusCode ?? 502, headers: {} })
    response.resume()
    ws.terminate()
    stream.close()
  })
  ws.on('message', (data, binary) => {
    if (!binary) stream.send(encoder.encode(data.toString()))
  })
  ws.on('close', () => stream.close())
  ws.on('error', () => stream.close())
  return {
    message(bytes) {
      if (open && ws.readyState === ws.OPEN) ws.send(decoder.decode(bytes))
    },
    close: () => ws.terminate(),
  }
}
