// One Durable Object per linked host. The host holds one WebSocket here; every device stream is its own WebSocket, and
// frames pass through untouched: they are sealed end to end, so this object routes bytes it cannot read. Hibernation
// keeps an idle host from costing anything, and pings are answered without waking the object.
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

const HOST = 'host'
const DEVICE = 'device'
/** A sealed record plus its tag and fragment flag; anything larger was not produced by a Ramu client. */
const MAX_DEVICE_FRAME = MAX_FRAME_BYTES + 64
const encoder = new TextEncoder()

interface DeviceAttachment {
  stream: number
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
      for (const ws of this.ctx.getWebSockets()) ws.close(LINK_CLOSE.hostOffline, 'Host unlinked')
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
    server.serializeAttachment({ stream } satisfies DeviceAttachment)
    this.streams.set(stream, server)
    const open: StreamOpen = { account: url.searchParams.get('account') ?? '' }
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
      if (frame.type === MUX.data) device.send(frame.payload)
      else if (frame.type === MUX.close) {
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
  }

  private async presence(hostId: string, online: boolean) {
    if (!/^[0-9a-f]{32}$/.test(hostId)) return
    await this.env.DB.prepare('UPDATE host SET online = ?, lastSeenAt = ? WHERE id = ?')
      .bind(online ? 1 : 0, Date.now(), hostId)
      .run()
  }
}
