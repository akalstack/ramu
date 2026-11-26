import { ServerResponse, type IncomingMessage, type Server } from 'node:http'
import type { Socket } from 'node:net'
import { randomBytes } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  decodeSocketFrame,
  encodeSocketFrame,
  MAX_REQUEST_BYTES,
  RESUME_HEADER,
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
  /** Unsent bytes at which a slow reader is disconnected, as slow event streams are. */
  maxBuffered?: number
  /** How long a dropped connection's events are kept for it to come back and take them. */
  resumeGraceMs?: number
  /** The most recent events kept per connection for a replay, in count and in bytes. */
  resumeEvents?: number
  resumeBytes?: number
}

/**
 * Events that ask the client to do something and wait for its answer (a native dialog, a browser operation). Kept for
 * a client that is not there, they would only time out; refusing them at once lets the host say nobody is connected.
 */
const NEEDS_LIVE_CLIENT = /^\{"channel":"(?:host:request|browser:operation)"/
/** Terminal output recovers from the terminal's own cursor after any reconnect, so it is never kept for a replay. */
const TERMINAL_STREAM = /^\{"channel":"term:(?:data|behind)"/

/**
 * One client's place on the event stream, kept across a short loss of its connection. Its events are numbered and the
 * latest are held, so a client that returns within the grace period names the last one it received and is sent the
 * rest, in order, instead of reading everything again. While it is away it stays attached to the host, so every event
 * meant for it (broadcast, or sent to that device or desktop alone) still reaches the same filters.
 */
interface Seat {
  id: string
  /** Who may take the seat back: the paired device, or the desktop client on this computer. */
  owner: string
  ws: WebSocket | null
  next: number
  recent: { n: number; json: string }[]
  recentBytes: number
  timer?: ReturnType<typeof setTimeout>
  /** Nothing more is delivered or kept: the grace period ended, the host closed it, or it was taken over. */
  gone: boolean
  /** The host ended this connection itself (a revoked device, a reader too slow); it is not kept for a return. */
  ended: boolean
  /** A returning client takes the seat with its new connection and is sent what followed event `last`. */
  take(ws: WebSocket, req: IncomingMessage, device: DeviceInfo | undefined, last: number): void
  leave(): void
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
  const resumeGraceMs = options.resumeGraceMs ?? 45_000
  const resumeEvents = options.resumeEvents ?? 1000
  const resumeBytes = options.resumeBytes ?? 512 * 1024
  const seats = new Map<string, Seat>()
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
        wss.handleUpgrade(req, socket, head, (ws) => arrive(ws, req, device ?? undefined))
      })
      .catch(() => socket.destroy())
  })

  /** A connection arrives: it takes back the seat it names when that can still be replayed, else it gets a new one. */
  const arrive = (ws: WebSocket, req: IncomingMessage, device: DeviceInfo | undefined) => {
    // A client that already has an event stream asks for calls only, so nothing is delivered twice.
    // A paired host only makes calls; it never receives this host's events, whatever it asks for.
    const callsOnly =
      device?.kind === 'host' || new URL(req.url ?? '/', 'http://host').searchParams.get('events') === 'none'
    const header = callsOnly ? undefined : req.headers[RESUME_HEADER]
    const asked = typeof header === 'string' ? /^([a-f0-9]{32}):(\d{1,15})$/.exec(header) : null
    const owner = device ? `device:${device.id}` : `local:${String(req.headers['x-ramu-desktop-client'] ?? '')}`
    const seat = asked ? seats.get(asked[1]!) : undefined
    if (seat && asked && seat.owner === owner && !seat.gone) {
      const last = Number(asked[2])
      // Everything after the last event the client holds must still be here, or it has to read again anyway.
      const newest = seat.next - 1
      const replayable = last === newest || (last < newest && seat.recent.length > 0 && seat.recent[0]!.n <= last + 1)
      if (replayable) return seat.take(ws, req, device, last)
      seat.leave()
    }
    connect(ws, req, device, callsOnly, typeof header === 'string' ? owner : null)
  }

  const connect = (
    first: WebSocket,
    firstReq: IncomingMessage,
    device: DeviceInfo | undefined,
    callsOnly: boolean,
    /** Who may take this connection's seat back; null for a client that does not ask for replays. */
    owner: string | null,
  ) => {
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

    const seat: Seat | null = owner
      ? {
          id: randomBytes(16).toString('hex'),
          owner,
          ws: first,
          next: 1,
          recent: [],
          recentBytes: 0,
          gone: false,
          ended: false,
          take: (ws, req, taker, last) => bind(ws, req, taker, last),
          leave: () => leave(),
        }
      : null
    if (seat) seats.set(seat.id, seat)
    // The connection events go out on now; null while the client is away and its seat is kept.
    let current: WebSocket | null = first
    let queued = () => 0
    let gone = false

    /** Numbers an event and keeps it among the latest, for a client that returns and names the last one it has. */
    const keep = (json: string): number => {
      const n = seat!.next++
      // One event larger than the whole allowance is not kept, and nothing before it can be replayed past it.
      if (json.length > resumeBytes) {
        seat!.recent = []
        seat!.recentBytes = 0
        return n
      }
      seat!.recent.push({ n, json })
      seat!.recentBytes += json.length
      while (seat!.recent.length > resumeEvents || seat!.recentBytes > resumeBytes)
        seat!.recentBytes -= seat!.recent.shift()!.json.length
      return n
    }
    /** Ends the seat for good: nothing more is kept, and the host stops sending to it. */
    const leave = () => {
      if (gone) return
      gone = true
      if (seat) {
        seat.gone = true
        clearTimeout(seat.timer)
        seats.delete(seat.id)
      }
      host.detach(sink)
    }

    const sink: EventSink = {
      write(chunk) {
        // Only data lines are events; SSE comments (keep-alives) have no meaning here.
        if (gone || !chunk.startsWith('data: ')) return true
        const json = chunk.slice(6).trimEnd()
        if (!current) {
          // Kept for the client's return, through the same filter it had when it left.
          if (!wanted(json) || TERMINAL_STREAM.test(json)) return true
          if (NEEDS_LIVE_CLIENT.test(json)) leave()
          else keep(json)
          return true
        }
        if (current.readyState !== current.OPEN) return true
        if (!wanted(json) || held(json)) return true
        if (seat && !TERMINAL_STREAM.test(json)) current.send(`{"t":"event","n":${keep(json)},${json.slice(1)}`)
        else current.send(`{"t":"event",${json.slice(1)}`)
        return queued() < maxBuffered
      },
      get writableLength() {
        return current ? queued() : 0
      },
      get destroyed() {
        return gone || (!!current && (current.readyState === current.CLOSED || current.readyState === current.CLOSING))
      },
      // The host ends it (a revoked device, a reader too slow, shutdown): the seat is not kept for a return.
      destroy: () => {
        if (seat) seat.ended = true
        if (current) current.terminate()
        else leave()
      },
      end: () => {
        if (seat) seat.ended = true
        if (current) current.close(1000)
        else leave()
      },
    }

    /** Wires one WebSocket to this seat: the first, or the one a returning client takes it back with. */
    function bind(ws: WebSocket, req: IncomingMessage, taker: DeviceInfo | undefined, resumeAfter: number | null) {
      open.add(ws)
      // A client that reconnected before the host noticed its old connection die: the old one ends without a say.
      const replaced = current
      current = ws
      if (seat) {
        seat.ws = ws
        clearTimeout(seat.timer)
      }
      if (replaced && replaced !== ws) replaced.terminate()
      // Answers still on their way, which the event limit leaves out: a long thread being sent must not make the next
      // event look like a client that fell behind.
      let answersQueued = 0
      queued = () => Math.max(0, ws.bufferedAmount - answersQueued)
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
      send({
        t: 'ready',
        epoch: host.epoch,
        ...(seat ? { resume: seat.id, ...(resumeAfter !== null ? { resumed: true } : {}) } : {}),
      })
      // A calls-only connection is attached too, listening to nothing, so revoking its device closes it like any stream.
      if (callsOnly) filter = { channels: new Set(), keys: new Map(), skip: new Map() }
      // Attached again on a return: the device's address and token may have changed with its network.
      host.attach(sink, req, taker)
      if (seat && resumeAfter !== null) {
        // Terminal windows start over, as on any new connection; the client fetches each terminal's own gap.
        windows.clear()
        behind.clear()
        for (const event of seat.recent)
          if (event.n > resumeAfter) ws.send(`{"t":"event","n":${event.n},${event.json.slice(1)}`)
      }
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
        void host
          .invoke(taker, { method: frame.method, args: frame.args, operationKey: frame.operationKey }, req)
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
        // Taken over by the client's next connection: this one has nothing left to end.
        if (current !== ws) return
        current = null
        if (!seat || seat.ended || closing) return leave()
        seat.ws = null
        seat.timer = setTimeout(leave, resumeGraceMs)
        seat.timer.unref()
      })
      ws.on('error', () => ws.terminate())
    }
    bind(first, firstReq, device, null)
  }

  let closing = false
  return {
    connections: () => open.size,
    close() {
      closing = true
      for (const seat of [...seats.values()]) if (!seat.ws) seat.leave()
      for (const ws of open) ws.close(1001)
      wss.close()
    },
  }
}
