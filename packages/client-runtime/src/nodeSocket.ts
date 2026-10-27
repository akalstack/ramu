import WebSocket from 'ws'
import { MAX_REQUEST_BYTES } from '@ramu/contracts'
import type { SocketFactory } from './socket'

/** The Node WebSocket, which can send the Authorization header and reports why an upgrade was refused. */
export const nodeSocketFactory: SocketFactory = (url, headers, handlers) => {
  const ws = new WebSocket(url, { headers, maxPayload: MAX_REQUEST_BYTES, handshakeTimeout: 10_000 })
  let status: number | undefined
  let code: string | undefined
  ws.on('open', () => {
    // Pooled sockets must not keep a short-lived client (the CLI) from exiting; pending calls keep their own timers.
    ;(ws as unknown as { _socket?: { unref?: () => void } })._socket?.unref?.()
    handlers.onopen()
  })
  ws.on('message', (data, binary) => {
    if (!binary) handlers.onmessage(data.toString())
  })
  ws.on('unexpected-response', (_request, response) => {
    status = response.statusCode
    response.resume()
    ws.terminate()
  })
  ws.on('error', (error) => {
    code = (error as NodeJS.ErrnoException).code
  })
  ws.on('close', () => handlers.onclose({ ...(status ? { status } : {}), ...(code ? { code } : {}) }))
  return {
    send: (text) => ws.send(text),
    close: () => ws.terminate(),
  }
}
