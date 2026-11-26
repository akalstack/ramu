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
  invoke(device: DeviceInfo | undefined, request: InvokeRequest, req: IncomingMessage): Promise<SocketInvokeResult>
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
  /**
   * Unsent event bytes at which a client is behind. One that can catch up stops receiving events until it has read what
   * is queued, then is told to fetch what it missed; any other is disconnected, as slow event streams are.
   */
  maxBuffered?: number
  /** Notes a connection the host ended and why, for the service log. */
  log?: (message: string) => void
  /** Called as each call starts; the returned function as it ends. */
  track?: (method: string) => () => void
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
  const log = options.log ?? (() => {})
  const track = options.track ?? (() => () => {})
  // Transcripts and lists are repetitive JSON, and a phone or tunnel pays for every byte. Small frames (tokens, acks)
  // skip the deflate, and no shared context means an idle connection holds no compression memory.
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_REQUEST_BYTES,
    perMessageDeflate: {
      threshold: 4096,
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
      zlibDeflateOptions: { level: 1 },
    },
  })
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
    let filter: {
      channels: Set<string> | null
      keys: Map<string, Set<string>>
      skip: Map<string, Set<string>>
    } | null = null
    // The channel is read from the front of the event text, so an unwanted or unkeyed event is never fully parsed; only
    // a keyed channel the client narrowed to particular ids, or whose event kinds it skips, is.
    const wanted = (json: string) => {
      if (!filter) return true
      const channel = /^\{"channel":"((?:[^"\\]|\\.)*)"/.exec(json)?.[1]
      if (channel === undefined || (filter.channels && !filter.channels.has(channel))) return false
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
    // Answers still on their way, which the event limit leaves out: a long thread being sent must not make the next
    // event look like a client that fell behind.
    let answersQueued = 0
    const eventsQueued = () => Math.max(0, ws.bufferedAmount - answersQueued)
    const params = new URL(req.url ?? '/', 'http://host').searchParams
    // A client that can fetch what it missed is never dropped for falling behind, as a thread subscription in T3 Code
    // is reset rather than its socket: dropping it showed the window reconnecting while several threads streamed.
    const canCatchUp = params.get('catchup') === '1'
    let catchingUp: ReturnType<typeof setInterval> | null = null
    const fellBehind = () => {
      log(
        `A client fell ${Math.round(eventsQueued() / 1024)} KB behind on events; it catches up once it has read them.`,
      )
      catchingUp = setInterval(() => {
        if (ws.readyState !== ws.OPEN || eventsQueued() > maxBuffered / 4) return
        clearInterval(catchingUp!)
        catchingUp = null
        send({ t: 'resync' })
      }, 250)
      catchingUp.unref()
    }
    const sink: EventSink = {
      write(chunk) {
        // Only data lines are events; SSE comments (keep-alives) have no meaning here.
        if (!chunk.startsWith('data: ') || ws.readyState !== ws.OPEN || catchingUp) return true
        const json = chunk.slice(6).trimEnd()
        if (!wanted(json) || held(json)) return true
        ws.send(`{"t":"event",${json.slice(1)}`)
        if (eventsQueued() < maxBuffered) return true
        if (!canCatchUp) return false
        fellBehind()
        return true
      },
      get writableLength() {
        return catchingUp ? 0 : eventsQueued()
      },
      get destroyed() {
        return ws.readyState === ws.CLOSED || ws.readyState === ws.CLOSING
      },
      destroy: () => ws.terminate(),
      end: () => ws.close(1000),
    }
    // Answers are sent whatever is queued: the client asked for each, and calls in flight are capped. Only events,
    // which a client never asked for one by one, end a connection that falls too far behind (see `sink.write`).
    // Ending it here dropped a desktop that opened a long thread from several places at once, and it asked again.
    const send = (frame: SocketServerFrame) => {
      if (ws.readyState !== ws.OPEN) return
      const text = encodeSocketFrame(frame)
      const bytes = Buffer.byteLength(text)
      answersQueued += bytes
      ws.send(text, () => (answersQueued -= bytes))
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
    let lastProbe = Date.now()
    ws.on('pong', () => (alive = true))
    const probe = setInterval(() => {
      // A probe that ran late means this service was busy, and the peer's answer may still be unread behind it: the
      // peer gets another interval rather than being dropped for this service's own pause.
      const late = Date.now() - lastProbe > heartbeatMs * 1.5
      lastProbe = Date.now()
      if (!alive && !late) {
        log(`A client did not answer for ${Math.round((2 * heartbeatMs) / 1000)} s; its connection was closed.`)
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
          // `everything` names the event kinds to thin without having to list each channel this client uses.
          channels: frame.everything ? null : new Set(frame.channels),
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
      const done = track(frame.method)
      void host
        .invoke(device, { method: frame.method, args: frame.args, operationKey: frame.operationKey }, req)
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
        .finally(() => {
          inFlight--
          done()
        })
    })
    ws.on('close', () => {
      clearInterval(probe)
      if (catchingUp) clearInterval(catchingUp)
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
