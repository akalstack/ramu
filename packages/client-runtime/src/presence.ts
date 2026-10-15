// A signed UDP announcement only wakes a connection; the server must still pass normal HTTP authentication.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createSocket, type Socket } from 'node:dgram'

const digest = (text: string) => createHash('sha256').update(text).digest('hex')
export const presenceKey = (token: string) => digest(token)
const identity = (key: string) => digest(`ramu-presence:${key}`).slice(0, 32)
const sign = (key: string, id: string, at: number, nonce: string) =>
  createHmac('sha256', key).update(`ramu-presence:1:${id}:${at}:${nonce}`).digest('hex')
export function presenceMessage(key: string, at = Date.now()): Buffer {
  const id = identity(key),
    nonce = randomBytes(16).toString('hex')
  return Buffer.from(JSON.stringify({ v: 1, id, at, nonce, mac: sign(key, id, at, nonce) }))
}

export class PresenceListener {
  private readonly sockets: Socket[] = []
  private readonly watchers = new Map<string, { key: string; callbacks: Set<() => void> }>()
  private readonly seen = new Map<string, number>()
  private closed = false
  port = 0

  async start(): Promise<void> {
    const ipv4 = createSocket('udp4')
    this.sockets.push(ipv4)
    ipv4.on('message', (message) => this.accept(message))
    ipv4.on('error', () => {})
    const ok = await new Promise<boolean>((resolve) => {
      ipv4.once('error', () => resolve(false))
      ipv4.bind(0, '0.0.0.0', () => resolve(true))
    })
    if (!ok || this.closed) {
      this.close()
      return
    }
    this.port = ipv4.address().port
    ipv4.unref()
    const ipv6 = createSocket({ type: 'udp6', ipv6Only: true })
    this.sockets.push(ipv6)
    ipv6.on('message', (message) => this.accept(message))
    ipv6.on('error', () => {})
    ipv6.bind(this.port, '::', () => ipv6.unref())
  }

  watch(token: string, wake: () => void): () => void {
    const key = presenceKey(token),
      id = identity(key)
    let entry = this.watchers.get(id)
    if (!entry) {
      entry = { key, callbacks: new Set() }
      this.watchers.set(id, entry)
    }
    entry.callbacks.add(wake)
    return () => {
      entry.callbacks.delete(wake)
      if (!entry.callbacks.size) this.watchers.delete(id)
    }
  }

  /** Kept public for protocol verification; malformed, unsigned and replayed packets have no effect. */
  accept(message: Buffer, now = Date.now()) {
    if (this.closed || message.length > 512) return
    try {
      const packet = JSON.parse(message.toString())
      if (
        packet.v !== 1 ||
        !Number.isSafeInteger(packet.at) ||
        Math.abs(now - packet.at) > 120000 ||
        !/^[a-f0-9]{32}$/.test(packet.nonce) ||
        !/^[a-f0-9]{64}$/.test(packet.mac)
      )
        return
      const entry = this.watchers.get(packet.id)
      if (!entry) return
      const expected = Buffer.from(sign(entry.key, packet.id, packet.at, packet.nonce), 'hex')
      if (!timingSafeEqual(expected, Buffer.from(packet.mac, 'hex'))) return
      const replay = `${packet.id}:${packet.nonce}`
      if (this.seen.has(replay)) return
      for (const [nonce, time] of this.seen) if (now - time > 120000) this.seen.delete(nonce)
      this.seen.set(replay, now)
      if (this.seen.size > 512) this.seen.delete(this.seen.keys().next().value!)
      for (const wake of entry.callbacks) wake()
    } catch {
      /* A packet cannot interrupt the app. */
    }
  }

  close() {
    this.closed = true
    this.port = 0
    this.watchers.clear()
    this.seen.clear()
    for (const socket of this.sockets) {
      try {
        socket.close()
      } catch {}
    }
    this.sockets.length = 0
  }
}
