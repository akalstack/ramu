// One Durable Object per linked host. The host holds one WebSocket here; every device stream is its own WebSocket, and
// frames pass through untouched: they are sealed end to end, so this object routes bytes it cannot read. Hibernation
// keeps an idle host from costing anything, and pings are answered without waking the object.
//
// Relayed time is what Cloudflare bills: the object awake carrying a stream. It is counted in memory for the host's
// owner and written to D1 a few seconds after traffic starts (an alarm, before the object can hibernate and lose it)
// and when a stream closes, never per frame.
import { DurableObject } from 'cloudflare:workers'
import {
  LINK_CLOSE,
  LINK_PROTOCOL,
  MAX_FRAME_BYTES,
  MAX_STREAMS_PER_HOST,
  MUX,
  decodeMux,
  encodeMux,
  type StreamOpen,
} from '@ramu/shared/link/protocol'
import type { Env } from './auth'
import { dayOf, recordUsage } from './plans'

const HOST = 'host'
const DEVICE = 'device'
/** A sealed record plus its tag and fragment flag; anything larger was not produced by a Ramu client. */
const MAX_DEVICE_FRAME = MAX_FRAME_BYTES + 64
const encoder = new TextEncoder()
/** Frames further apart than this are separate bursts; the gap between them is not counted as relayed time. */
const AWAKE_GAP_MS = 10_000
/** Shorter than the idle time after which a Durable Object may hibernate, so counts are written before they are lost. */
const FLUSH_MS = 8_000

interface DeviceAttachment {
  stream: number
  /** The account the stream was opened by, and the host owner whose relayed time it counts toward. */
  account: string
  owner: string
}
interface Meter {
  ms: number
  frames: number
  last: number
}

export class HostRelay extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  private host(): WebSocket | undefined {
    return this.ctx.getWebSockets(HOST)[0]
  }

  /** Called by the Worker after it authenticated the caller; `role` and `account` come from there, never the client. */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const role = url.searchParams.get('role')
    const hostId = url.searchParams.get('host') ?? ''
    if (role === 'evict') {
      const account = url.searchParams.get('account')
      for (const ws of this.ctx.getWebSockets()) {
        // With an account, only that account's streams end (a share was removed); otherwise the host was unlinked.
        if (account && (ws.deserializeAttachment() as DeviceAttachment | null)?.account !== account) continue
        ws.close(LINK_CLOSE.hostOffline, account ? 'No longer shared' : 'Host unlinked')
      }
      return new Response(null, { status: 204 })
    }
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
    const answer = () =>
      new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': LINK_PROTOCOL } })
    if (role === HOST) {
      // A host that reconnects replaces its old socket, and streams carried by the old one cannot continue.
      for (const ws of this.ctx.getWebSockets()) ws.close(LINK_CLOSE.hostClosed, 'Host reconnected')
      this.ctx.acceptWebSocket(server, [HOST])
      await this.ctx.storage.put('hostId', hostId)
      await this.presence(hostId, true)
      return answer()
    }
    const host = this.host()
    this.ctx.acceptWebSocket(server, [DEVICE])
    if (!host) {
      server.close(LINK_CLOSE.hostOffline, 'Host offline')
      return answer()
    }
    if (this.ctx.getWebSockets(DEVICE).length > MAX_STREAMS_PER_HOST) {
      server.close(LINK_CLOSE.limit, 'Too many streams')
      return answer()
    }
    const fresh = () => crypto.getRandomValues(new Uint32Array(1))[0]! || 1
    let stream = fresh()
    while (this.device(stream)) stream = fresh()
    const account = url.searchParams.get('account') ?? ''
    server.serializeAttachment({
      stream,
      account,
      owner: url.searchParams.get('owner') ?? '',
    } satisfies DeviceAttachment)
    this.streams.set(stream, server)
    const open: StreamOpen = { account, ...(url.searchParams.get('shared') === '1' ? { shared: true } : {}) }
    host.send(encodeMux(MUX.open, stream, encoder.encode(JSON.stringify(open))))
    return answer()
  }

  /** Rebuilt after hibernation from each device socket's attachment. */
  private readonly streams = new Map<number, WebSocket>()
  private device(stream: number): WebSocket | undefined {
    const known = this.streams.get(stream)
    if (known) return known
    for (const ws of this.ctx.getWebSockets(DEVICE)) {
      const attachment = ws.deserializeAttachment() as DeviceAttachment | null
      if (attachment) this.streams.set(attachment.stream, ws)
    }
    return this.streams.get(stream)
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message === 'string') return
    const bytes = new Uint8Array(message)
    if (this.ctx.getTags(ws).includes(HOST)) {
      const frame = decodeMux(bytes)
      if (!frame) return
      const device = this.device(frame.stream)
      if (!device) {
        if (frame.type !== MUX.close) ws.send(encodeMux(MUX.close, frame.stream))
        return
      }
      if (frame.type === MUX.data) {
        device.send(frame.payload)
        this.meter(device)
      } else if (frame.type === MUX.close) {
        this.streams.delete(frame.stream)
        device.close(LINK_CLOSE.hostClosed, 'Closed by host')
      }
      return
    }
    const attachment = ws.deserializeAttachment() as DeviceAttachment | null
    const host = this.host()
    if (!attachment || !host) return ws.close(LINK_CLOSE.hostOffline, 'Host offline')
    if (bytes.length > MAX_DEVICE_FRAME) return ws.close(1009, 'Frame too large')
    host.send(encodeMux(MUX.data, attachment.stream, bytes))
    this.meter(ws)
  }

  /** Counted per owner in memory; rebuilt empty after hibernation, which only happens once everything was written. */
  private readonly meters = new Map<string, Meter>()
  private flushScheduled = false

  private meter(ws: WebSocket) {
    const owner = (ws.deserializeAttachment() as DeviceAttachment | null)?.owner
    if (!owner) return
    const now = Date.now()
    const meter = this.meters.get(owner) ?? { ms: 0, frames: 0, last: 0 }
    if (meter.last && now - meter.last < AWAKE_GAP_MS) meter.ms += now - meter.last
    meter.frames += 1
    meter.last = now
    this.meters.set(owner, meter)
    if (!this.flushScheduled) {
      this.flushScheduled = true
      void this.ctx.storage.setAlarm(now + FLUSH_MS)
    }
  }

  async alarm() {
    this.flushScheduled = false
    await this.flush()
  }

  /** Writes whole seconds and every frame counted so far; a part second waits for the next write. */
  private async flush() {
    const day = dayOf(Date.now())
    const entries = []
    for (const [userId, meter] of this.meters) {
      const seconds = Math.floor(meter.ms / 1000)
      if (!seconds && !meter.frames) continue
      entries.push({ userId, day, seconds, frames: meter.frames })
      meter.ms -= seconds * 1000
      meter.frames = 0
    }
    if (entries.length) await recordUsage(this.env, entries).catch(() => {})
  }

  async webSocketClose(ws: WebSocket) {
    await this.closed(ws)
  }
  async webSocketError(ws: WebSocket) {
    await this.closed(ws)
  }

  private async closed(ws: WebSocket) {
    if (this.ctx.getTags(ws).includes(HOST)) {
      // Only the current host socket going away takes the host offline; a replaced one already handed over.
      if (this.ctx.getWebSockets(HOST).some((other) => other !== ws)) return
      for (const device of this.ctx.getWebSockets(DEVICE)) device.close(LINK_CLOSE.hostOffline, 'Host offline')
      this.streams.clear()
      await this.flush()
      const hostId = await this.ctx.storage.get<string>('hostId')
      if (hostId) await this.presence(hostId, false)
      return
    }
    const attachment = ws.deserializeAttachment() as DeviceAttachment | null
    if (!attachment) return
    this.streams.delete(attachment.stream)
    try {
      this.host()?.send(encodeMux(MUX.close, attachment.stream))
    } catch {}
    await this.flush()
  }

  private async presence(hostId: string, online: boolean) {
    if (!/^[0-9a-f]{32}$/.test(hostId)) return
    await this.env.DB.prepare('UPDATE host SET online = ?, lastSeenAt = ? WHERE id = ?')
      .bind(online ? 1 : 0, Date.now(), hostId)
      .run()
  }
}
