import WebSocket from 'ws'
import { MAX_SOCKET_FRAME_BYTES } from '@ramu/contracts'
import type { SocketFactory } from './socket'

/** The Node WebSocket, which can send the Authorization header and reports why an upgrade was refused. */
export const nodeSocketFactory: SocketFactory = (url, headers, handlers) => {
  const ws = new WebSocket(url, { headers, maxPayload: MAX_SOCKET_FRAME_BYTES, handshakeTimeout: 10_000 })
  let status: number | undefined
  ws.on('open', handlers.onopen)
  ws.on('message', (data, binary) => {
    if (!binary) handlers.onmessage(data.toString())
  })
  ws.on('unexpected-response', (_request, response) => {
    status = response.statusCode
    response.resume()
    ws.terminate()
  })
  ws.on('error', () => {})
  ws.on('close', () => handlers.onclose({ ...(status ? { status } : {}) }))
  return {
    send: (text) => ws.send(text),
    close: () => ws.terminate(),
  }
}
