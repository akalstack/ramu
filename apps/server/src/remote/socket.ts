import { ServerResponse, type IncomingMessage, type Server } from 'node:http'
import type { Socket } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  decodeSocketFrame,
  encodeSocketFrame,
  MAX_REQUEST_BYTES,
  SOCKET_EVENT_KEYS,
  SOCKET_PATH,
  TERMINAL_FLOW_WINDOW,
  type InvokeRequest,
  type SocketServerFrame,
} from '@ramu/contracts'
import { OutputWindow } from '@ramu/shared/sync/streamSync'
import type { DeviceInfo } from './devices'

/** What the event broadcast needs from a connected client; an SSE response and a WebSocket both fit. */
export interface EventSink {
  write(chunk: string): boolean
  readonly writableLength: number
  readonly destroyed: boolean
  destroy(): void
  end(): void
}

export type SocketInvokeResult =
  { ok: true; value: unknown; after?: () => void } | { ok: false; status: number; error: string }

export interface SocketHost {
  /** The same authentication every remote request gets. `undefined` means it already answered the upgrade. */
  accept(req: IncomingMessage, res: ServerResponse): Promise<DeviceInfo | null | undefined>
  /** Runs one call exactly as `POST /invoke` would for this device. Must not throw. */
  invoke(device: DeviceInfo | undefined, request: InvokeRequest): Promise<SocketInvokeResult>
  /** Identifies this server run, so a client that sees it change knows every cursor it held is void. */
  epoch: string
  /** Registers the client for broadcast events (and presence, revocation) until `close`. */
  attach(sink: EventSink, req: IncomingMessage, device: DeviceInfo | undefined): void
  detach(sink: EventSink): void
}

export interface SocketOptions {
  /** How often an idle connection is probed; a peer that never answers is dropped after one more interval. */
  heartbeatMs?: number
  /** Calls one connection may have running at once; more are refused rather than queued without bound. */
  maxInFlight?: number
  /** Unsent bytes at which a slow reader is disconnected, as slow event streams are. */
  maxBuffered?: number
}

/**
 * Serves `SOCKET_PATH` as a WebSocket carrying the same calls and events as `POST /invoke` and `GET /events`. The
 * upgrade is authenticated with the Authorization header before it is accepted, so no credential is ever in a URL and
 * an unauthenticated peer never gets a socket. Every call goes through `host.invoke`: this adds a transport, not a
 * second API.
 */
export function serveSockets(server: Server, host: SocketHost, options: SocketOptions = {}) {
  const heartbeatMs = options.heartbeatMs ?? 30_000
  const maxInFlight = options.maxInFlight ?? 32
  const maxBuffered = options.maxBuffered ?? 8 * 1024 * 1024
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_REQUEST_BYTES })
  const open = new Set<WebSocket>()

  server.on('upgrade', (req, socket, head) => {
    // A reachability probe may cancel while authentication is still pending, before ws owns the connection.
    socket.on('error', () => socket.destroy())
    const path = (req.url ?? '/').split('?')[0]
    if (path !== SOCKET_PATH) {
      socket.destroy()
      return
    }
    // A response bound to the upgrade's socket lets the ordinary authentication answer 401/429 itself.
    const res = new ServerResponse(req)
    res.on('error', () => socket.destroy())
    res.assignSocket(socket as Socket)
    // A refusal ends the connection once it is written; an upgrade request has no further use for the socket.
    res.once('finish', () => socket.end())
    void host
      .accept(req, res)
      .then((device) => {
        if (device === undefined) return
        res.removeAllListeners('finish')
        res.detachSocket(socket as Socket)
        wss.handleUpgrade(req, socket, head, (ws) => connect(ws, req, device ?? undefined))
      })
      .catch(() => socket.destroy())
  })

  const connect = (ws: WebSocket, req: IncomingMessage, device: DeviceInfo | undefined) => {
    open.add(ws)
    // Until a client subscribes it receives every event, as an SSE client does. A subscription narrows delivery to the
    // listed channels, and for resource channels to the listed ids; it is replaced whole by the next one.
    let filter: { channels: Set<string>; keys: Map<string, Set<string>>; skip: Map<string, Set<string>> } | null = null
    // The channel is read from the front of the event text, so an unwanted or unkeyed event is never fully parsed; only
    // a keyed channel the client narrowed to particular ids, or whose event kinds it skips, is.
    const wanted = (json: string) => {
      if (!filter) return true
      const channel = /^\{"channel":"((?:[^"\\]|\\.)*)"/.exec(json)?.[1]
      if (channel === undefined || !filter.channels.has(channel)) return false
      const keys = filter.keys.get(channel)
      const skip = filter.skip.get(channel)
      const field = SOCKET_EVENT_KEYS[channel]
      if ((!keys && !skip) || !field) return true
      try {
        const event = JSON.parse(json) as { payload?: Record<string, unknown> & { event?: { kind?: unknown } } }
        // A resource the client named is delivered in full; any other loses the kinds it asked to skip, or all of it
        // when it named resources and skipped nothing.
        if (keys?.has(String(event.payload?.[field]))) return true
        if (skip) return !skip.has(String(event.payload?.event?.kind))
        return !keys
      } catch {
        return false
      }
    }
    // With flow control on, terminal output the client has not acknowledged is bounded: past the window further chunks are
    // withheld, and one `term:behind` tells the client to fetch the gap from the terminal's own cursor once it has caught up.
    let flow = false
    const windows = new Map<string, OutputWindow>()
    const behind = new Set<string>()
    const held = (json: string) => {
      if (!flow || !json.startsWith('{"channel":"term:data"')) return false
      try {
        const { payload } = JSON.parse(json) as { payload?: { id?: unknown; data?: unknown } }
        if (typeof payload?.id !== 'string' || typeof payload.data !== 'string') return false
        // Once a chunk was withheld, every later one is too: the client then fetches one contiguous gap, never a hole.
        if (behind.has(payload.id)) return true
        let window = windows.get(payload.id)
        if (!window) windows.set(payload.id, (window = new OutputWindow(TERMINAL_FLOW_WINDOW)))
        if (window.canSend(payload.data.length)) {
          window.sent(payload.data.length)
          return false
        }
        behind.add(payload.id)
        return true
      } catch {
        return false
      }
    }
    const sink: EventSink = {
      write(chunk) {
        // Only data lines are events; SSE comments (keep-alives) have no meaning here.
        if (!chunk.startsWith('data: ') || ws.readyState !== ws.OPEN) return true
        const json = chunk.slice(6).trimEnd()
        if (!wanted(json) || held(json)) return true
        ws.send(`{"t":"event",${json.slice(1)}`)
        return ws.bufferedAmount < maxBuffered
      },
      get writableLength() {
        return ws.bufferedAmount
      },
      get destroyed() {
        return ws.readyState === ws.CLOSED || ws.readyState === ws.CLOSING
      },
      destroy: () => ws.terminate(),
      end: () => ws.close(1000),
    }
    const send = (frame: SocketServerFrame) => {
      if (ws.readyState !== ws.OPEN) return
      if (ws.bufferedAmount > maxBuffered) {
        ws.terminate()
        return
      }
      ws.send(encodeSocketFrame(frame))
    }
    send({ t: 'ready', epoch: host.epoch })
    // A client that already has an event stream asks for calls only, so nothing is delivered twice.
    // A paired host only makes calls; it never receives this host's events, whatever it asks for.
    const callsOnly =
      device?.kind === 'host' || new URL(req.url ?? '/', 'http://host').searchParams.get('events') === 'none'
    // A calls-only connection is attached too, listening to nothing, so revoking its device closes it like any stream.
    if (callsOnly) filter = { channels: new Set(), keys: new Map(), skip: new Map() }
    host.attach(sink, req, device)
    let inFlight = 0
    let alive = true
    ws.on('pong', () => (alive = true))
    const probe = setInterval(() => {
      if (!alive) {
        ws.terminate()
        return
      }
      alive = false
      ws.ping()
    }, heartbeatMs)
    probe.unref()
    ws.on('message', (data, binary) => {
      alive = true
      const frame = binary ? null : decodeSocketFrame(data.toString(), 'client')
      if (!frame) {
        ws.close(1008, 'Invalid frame')
        return
      }
      if (frame.t === 'ping') {
        send({ t: 'pong' })
        return
      }
      if (frame.t === 'ack') {
        const window = windows.get(frame.id)
        if (!flow || !window) return
        window.ack(frame.bytes)
        if (window.pending > 0) return
        windows.delete(frame.id)
        if (behind.delete(frame.id)) send({ t: 'event', channel: 'term:behind', payload: { id: frame.id } })
        return
      }
      if (frame.t === 'subscribe') {
        if (callsOnly) {
          send({ t: 'error', id: frame.id, error: 'This connection carries no events.', status: 400 })
          return
        }
        flow = frame.flow === true
        windows.clear()
        behind.clear()
        filter = {
          channels: new Set(frame.channels),
          keys: new Map(Object.entries(frame.keys ?? {}).map(([channel, list]) => [channel, new Set(list)])),
          skip: new Map(Object.entries(frame.skip ?? {}).map(([channel, list]) => [channel, new Set(list)])),
        }
        send({ t: 'result', id: frame.id, value: { channels: frame.channels.length } })
        return
      }
      if (inFlight >= maxInFlight) {
        send({ t: 'error', id: frame.id, error: 'Too many calls are running on this connection.', status: 429 })
        return
      }
      inFlight++
      void host
        .invoke(device, { method: frame.method, args: frame.args, operationKey: frame.operationKey })
        .then((result) => {
          if (result.ok) {
            send({ t: 'result', id: frame.id, value: result.value })
            result.after?.()
          } else send({ t: 'error', id: frame.id, error: result.error, status: result.status })
        })
        .catch((error: unknown) =>
          send({
            t: 'error',
            id: frame.id,
            error: error instanceof Error ? error.message : String(error),
            status: 400,
          }),
        )
        .finally(() => inFlight--)
    })
    ws.on('close', () => {
      clearInterval(probe)
      open.delete(ws)
      host.detach(sink)
    })
    ws.on('error', () => ws.terminate())
  }

  return {
    connections: () => open.size,
    close() {
      for (const ws of open) ws.close(1001)
      wss.close()
    },
  }
}
