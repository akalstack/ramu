// The host's one outbound connection to its Ramu Link relay. Each device stream arrives multiplexed on it, runs the Noise
// handshake here with the host's identity key, and is then bridged to the host's own remote server.
import { randomBytes } from 'node:crypto'
import type { Server } from 'node:http'
import WebSocket from 'ws'
import { answerLink, type SecureChannel } from '@ramu/shared/link/channel'
import type { KeyPair } from '@ramu/shared/link/noise'
import {
  LINK_CLOSE,
  LINK_PATHS,
  LINK_PROTOCOL,
  MAX_STREAMS_PER_HOST,
  MUX,
  decodeMux,
  encodeMux,
  hostProtocol,
  type StreamOpen,
} from '@ramu/shared/link/protocol'
import { bridge, parseLinkRequest, type Bridge } from './bridge'
import { SHARED_LINK_PEER } from '../sharedPeer'

export type RelayState = 'connecting' | 'online' | 'offline' | 'unauthorized'

interface Stream {
  account: string
  shared: boolean
  channel: SecureChannel | null
  bridge: Bridge | null
}

export interface RelayClientOptions {
  service: string
  hostId: string
  secret: string
  identity: KeyPair
  server: Server
  onState(state: RelayState, error?: string): void
  /** Test seam. */
  WebSocketImpl?: typeof WebSocket
}

const random = (bytes: number) => new Uint8Array(randomBytes(bytes))
const decoder = new TextDecoder()

export class RelayClient {
  private ws: WebSocket | null = null
  private streams = new Map<number, Stream>()
  private stopped = false
  private failures = 0
  private retry: NodeJS.Timeout | undefined
  private beat: NodeJS.Timeout | undefined
  state: RelayState = 'connecting'

  constructor(private readonly options: RelayClientOptions) {}

  start() {
    this.stopped = false
    this.connect()
  }

  stop() {
    this.stopped = true
    clearTimeout(this.retry)
    clearInterval(this.beat)
    this.closeStreams()
    this.ws?.terminate()
    this.ws = null
  }

  /** Open device streams, for status. */
  streamCount() {
    return this.streams.size
  }

  private set(state: RelayState, error?: string) {
    this.state = state
    this.options.onState(state, error)
  }

  private connect() {
    if (this.stopped) return
    this.set('connecting')
    const url = new URL(LINK_PATHS.relayHost, this.options.service)
    url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:'
    const Impl = this.options.WebSocketImpl ?? WebSocket
    const ws = new Impl(url, [LINK_PROTOCOL, hostProtocol(this.options.secret)], {
      handshakeTimeout: 15_000,
      maxPayload: 1024 * 1024,
      perMessageDeflate: false,
    })
    this.ws = ws
    let refused: number | undefined
    ws.on('open', () => {
      this.failures = 0
      this.set('online')
      clearInterval(this.beat)
      // The relay answers this text ping itself without waking; it keeps NAT and proxies from dropping an idle host.
      this.beat = setInterval(() => ws.readyState === ws.OPEN && ws.send('ping'), 30_000)
      this.beat.unref()
    })
    ws.on('message', (data, binary) => {
      if (!binary) return
      this.frame(new Uint8Array(data as Buffer))
    })
    ws.on('close', (code) => this.disconnected(refused ?? code))
    ws.on('unexpected-response', (_request, response) => {
      refused = response.statusCode === 401 ? LINK_CLOSE.unauthorized : undefined
      response.resume()
      ws.terminate()
    })
    ws.on('error', () => {})
  }

  private disconnected(code: number | undefined) {
    clearInterval(this.beat)
    this.closeStreams()
    this.ws = null
    if (this.stopped) return
    if (code === LINK_CLOSE.unauthorized) {
      this.set('unauthorized', 'This host is no longer linked to your account. Sign in to Ramu Link again.')
      return
    }
    this.set('offline')
    const delay = Math.min(60_000, 1000 * 2 ** this.failures++) * (0.75 + Math.random() * 0.5)
    this.retry = setTimeout(() => this.connect(), delay)
    this.retry.unref()
  }

  private closeStreams() {
    for (const stream of this.streams.values()) stream.bridge?.close()
    this.streams.clear()
  }

  private send(stream: number, type: typeof MUX.data | typeof MUX.close, payload?: Uint8Array) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encodeMux(type, stream, payload))
  }

  private end(id: number) {
    const stream = this.streams.get(id)
    if (!stream) return
    this.streams.delete(id)
    stream.bridge?.close()
    this.send(id, MUX.close)
  }

  private frame(bytes: Uint8Array) {
    const frame = decodeMux(bytes)
    if (!frame) return
    const { stream: id, payload } = frame
    if (frame.type === MUX.open) {
      if (this.streams.size >= MAX_STREAMS_PER_HOST) return this.send(id, MUX.close)
      let account = ''
      let shared = false
      try {
        const open = JSON.parse(decoder.decode(payload)) as StreamOpen
        account = String(open.account ?? '').slice(0, 100)
        shared = open.shared === true
      } catch {}
      this.streams.set(id, { account, shared, channel: null, bridge: null })
      return
    }
    const stream = this.streams.get(id)
    if (!stream) return
    if (frame.type === MUX.close) {
      this.streams.delete(id)
      stream.bridge?.close()
      return
    }
    try {
      if (!stream.channel) {
        const { reply, channel } = answerLink(this.options.hostId, this.options.identity, payload, random)
        stream.channel = channel
        this.send(id, MUX.data, reply)
        return
      }
      const message = stream.channel.open(payload)
      if (!message) return
      if (stream.bridge) return stream.bridge.message(message)
      const request = parseLinkRequest(message)
      if (!request) return this.end(id)
      const channel = stream.channel
      // A shared account is another person: its own peer name keeps it out of the owner's pairing shortcuts.
      const peer = `${stream.shared ? SHARED_LINK_PEER : 'link:'}${stream.account || 'unknown'}`
      stream.bridge = bridge(this.options.server, peer, request, {
        send: (out) => {
          if (!this.streams.has(id)) return
          for (const record of channel.seal(out)) this.send(id, MUX.data, record)
        },
        close: () => this.end(id),
      })
    } catch {
      // A forged record, a failed handshake or an oversized message ends only this stream.
      this.end(id)
    }
  }
}
