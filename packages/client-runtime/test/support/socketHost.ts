import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import { SOCKET_PATH, decodeSocketFrame, encodeSocketFrame, type SocketServerFrame } from '@ramu/contracts'

export interface HostCall {
  method: string
  args: unknown[]
  operationKey?: string
}
export interface Connection {
  ws: WebSocket
  headers: IncomingHttpHeaders
  url: string
}

/** A scripted Ramu host: accepts upgrades for one token (`'*'` accepts any), answers calls through `answer`, and pushes events on demand. */
export async function socketHost(
  options: {
    token?: string
    epoch?: () => string
    /** Returns the value, throws to send an error frame, or returns `DROP` to cut the connection without answering. */
    answer?: (call: HostCall, connection: Connection) => unknown
    /** Refuse the upgrade with this status instead of accepting it. */
    refuse?: number
    /** Listen on this unix socket path instead of a TCP port, as the local service does. */
    unix?: string
  } = {},
) {
  const token = options.token ?? 'secret'
  const connections: Connection[] = []
  const calls: HostCall[] = []
  const upgrades: IncomingHttpHeaders[] = []
  const server: Server = createServer((_req, res) => res.writeHead(404).end())
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    upgrades.push(req.headers)
    const status =
      options.refuse ?? (options.unix || token === '*' || req.headers.authorization === `Bearer ${token}` ? 0 : 401)
    if (!req.url?.startsWith(SOCKET_PATH) || status) {
      socket.end(`HTTP/1.1 ${status || 404} Refused\r\nConnection: close\r\n\r\n`)
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const connection: Connection = { ws, headers: req.headers, url: req.url ?? '' }
      connections.push(connection)
      ws.on('message', (data) => {
        const frame = decodeSocketFrame(data.toString(), 'client')
        if (!frame) return
        if (frame.t === 'ping') return void ws.send(encodeSocketFrame({ t: 'pong' }))
        if (frame.t !== 'invoke') return
        const call: HostCall = {
          method: frame.method,
          args: frame.args,
          ...(frame.operationKey ? { operationKey: frame.operationKey } : {}),
        }
        calls.push(call)
        try {
          const value = options.answer ? options.answer(call, connection) : call
          if (value === DROP) return void ws.terminate()
          ws.send(encodeSocketFrame({ t: 'result', id: frame.id, value }))
        } catch (error) {
          ws.send(
            encodeSocketFrame({
              t: 'error',
              id: frame.id,
              error: error instanceof Error ? error.message : String(error),
            }),
          )
        }
      })
      ws.send(encodeSocketFrame({ t: 'ready', epoch: options.epoch?.() ?? 'run-a' }))
    })
  })
  await new Promise<void>((resolve) =>
    options.unix ? server.listen(options.unix, resolve) : server.listen(0, '127.0.0.1', resolve),
  )
  const port = options.unix ? 0 : (server.address() as AddressInfo).port
  const send = (frame: SocketServerFrame) => {
    for (const { ws } of connections) if (ws.readyState === ws.OPEN) ws.send(encodeSocketFrame(frame))
  }
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    endpoint: { kind: 'http' as const, url: `http://127.0.0.1:${port}`, token },
    connections,
    calls,
    upgrades,
    push: (channel: string, payload: unknown = {}) => send({ t: 'event', channel, payload }),
    drop: () => {
      for (const { ws } of connections) ws.terminate()
    },
    open: () => connections.filter(({ ws }) => ws.readyState === ws.OPEN).length,
    close: async () => {
      for (const { ws } of connections) ws.terminate()
      wss.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
export const DROP = Symbol('drop')
