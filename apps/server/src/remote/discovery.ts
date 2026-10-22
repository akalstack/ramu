// Advertises this host to nearby devices with multicast DNS (DNS-SD, "Bonjour"). It runs only while network access and
// the separate Discoverable setting are both on, starts only after the listener has bound, publishes the address the
// listener actually bound, and says goodbye when stopped. A failure here never touches the listener: the server keeps
// working and the status says why nothing is advertised.
import { createSocket, type Socket } from 'node:dgram'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { hostname as osHostname, networkInterfaces } from 'node:os'
import {
  cleanDiscoveryName,
  DISCOVERY_VERSION,
  usableAddress,
  type DiscoveryAdvert,
} from '@ramu/shared/discovery/contract'
import { MDNS_ADDRESS, MDNS_PORT, decodeMessage, encodeResponse } from '@ramu/shared/discovery/mdns'
import {
  asks,
  conflictsWith,
  instanceLabel,
  publicationRecords,
  type Publication,
} from '@ramu/shared/discovery/advertise'

type Interfaces = ReturnType<typeof networkInterfaces>

/** One multicast socket pinned to a single network interface. */
export interface MulticastLink {
  send(packet: Uint8Array): void
  close(): void
}
export type LinkFactory = (
  interfaceAddress: string,
  onPacket: (packet: Uint8Array) => void,
  onError: (error: Error) => void,
) => Promise<MulticastLink>

export type DiscoveryState = 'off' | 'advertising' | 'unavailable'

export interface DiscoveryStatus {
  state: DiscoveryState
  /** Names of the interfaces being advertised on. */
  interfaces: string[]
  /** Short code such as `EADDRINUSE`; never a native message. */
  error: string | null
  /** Instance label other devices see. */
  label: string | null
}

const TTL_SECONDS = 120
const REFRESH_MS = 60_000
const MAX_RESPONSES_PER_SECOND = 8

export const nativeLink: LinkFactory = (interfaceAddress, onPacket, onError) =>
  new Promise((resolve, reject) => {
    const socket: Socket = createSocket({ type: 'udp4', reuseAddr: true })
    socket.once('error', reject)
    socket.on('message', (message) => onPacket(new Uint8Array(message.buffer, message.byteOffset, message.byteLength)))
    socket.bind(MDNS_PORT, () => {
      try {
        socket.off('error', reject)
        socket.on('error', onError)
        // Only this interface carries the traffic: membership, outgoing interface and no loopback echo.
        socket.addMembership(MDNS_ADDRESS, interfaceAddress)
        socket.setMulticastInterface(interfaceAddress)
        socket.setMulticastTTL(255)
        socket.setMulticastLoopback(false)
        resolve({
          send: (packet) => socket.send(packet, MDNS_PORT, MDNS_ADDRESS, (error) => error && onError(error)),
          close: () => {
            try {
              socket.close()
            } catch {}
          },
        })
      } catch (error) {
        socket.close()
        reject(error)
      }
    })
  })

interface Wanted {
  name: string
  /** The IPv4 address that joins the multicast group and the addresses to publish for this interface. */
  join: string
  addresses: string[]
}

/**
 * The interfaces to advertise on: those that the listener really serves. A specific bind advertises only the interface
 * that owns the address, a wildcard every non-loopback interface with an IPv4 address (needed to join multicast).
 * Loopback and link-local addresses are never published.
 */
export function advertisedInterfaces(host: string, interfaces: Interfaces = networkInterfaces()): Wanted[] {
  const found: Wanted[] = []
  const wildcard = host === '0.0.0.0' || host === '::'
  for (const [name, entries] of Object.entries(interfaces)) {
    const usable = (entries ?? []).filter((entry) => !entry.internal && usableAddress(entry.address))
    const v4 = usable.find((entry) => entry.family === 'IPv4')
    if (!v4) continue
    const serves = (address: string) => (host === '0.0.0.0' ? !address.includes(':') : wildcard || address === host)
    const addresses = usable.map((entry) => entry.address).filter(serves)
    if (addresses.length) found.push({ name, join: v4.address, addresses })
  }
  return found
}

/** A random identifier stored with the host's data. It is a hint to recognise a host, never proof of identity. */
export function readDiscoveryHostId(path: string): string {
  try {
    const saved = JSON.parse(readFileSync(path, 'utf8')) as { hostId?: unknown }
    if (typeof saved.hostId === 'string' && /^[0-9a-f]{32}$/.test(saved.hostId)) return saved.hostId
  } catch {}
  const hostId = randomBytes(16).toString('hex')
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, JSON.stringify({ hostId }), { mode: 0o600 })
  return hostId
}

export const discoveryName = () => cleanDiscoveryName(osHostname().replace(/\.local$/i, '')) || 'Ramu host'

export class HostAdvertiser {
  private links = new Map<string, { link: MulticastLink; publication: Publication }>()
  private target: { host: string; port: number; tls: boolean } | null = null
  private suffix = 0
  private generation = 0
  private timer: ReturnType<typeof setInterval> | undefined
  private error: string | null = null
  private responses: number[] = []

  constructor(
    private readonly options: {
      hostId: string
      name?: () => string
      interfaces?: () => Interfaces
      link?: LinkFactory
      random?: () => number
      now?: () => number
      onChange?: () => void
    },
  ) {}

  status(): DiscoveryStatus {
    const first = [...this.links.values()][0]
    return {
      state: this.links.size ? 'advertising' : this.target ? 'unavailable' : 'off',
      interfaces: [...this.links.keys()],
      error: this.target && !this.links.size ? (this.error ?? 'NO_INTERFACE') : null,
      label: first?.publication.label ?? null,
    }
  }

  private advert(): DiscoveryAdvert {
    return {
      version: DISCOVERY_VERSION,
      hostId: this.options.hostId,
      name: cleanDiscoveryName((this.options.name ?? discoveryName)()) || 'Ramu host',
      scheme: this.target?.tls ? 'https' : 'http',
    }
  }

  /** Call only after the listener has bound `host:port`. Replaces any earlier advertisement. */
  async start(target: { host: string; port: number; tls: boolean }): Promise<void> {
    await this.stop()
    // Loopback-only listeners are not reachable by another device, so nothing is published.
    if (/^127\./.test(target.host) || target.host === '::1') return
    this.target = target
    this.error = null
    await this.publish()
    clearInterval(this.timer)
    this.timer = setInterval(() => this.announce(TTL_SECONDS), REFRESH_MS)
    this.timer.unref?.()
  }

  /** Re-reads the interfaces after a network change or wake. */
  async refresh(): Promise<void> {
    if (!this.target) return
    await this.publish()
  }

  private async publish(): Promise<void> {
    const target = this.target
    if (!target) return
    const generation = ++this.generation
    const wanted = advertisedInterfaces(target.host, this.options.interfaces?.())
    const keep = new Set(wanted.map((entry) => entry.name))
    for (const [name, entry] of [...this.links]) {
      if (keep.has(name)) continue
      this.send(entry, 0)
      entry.link.close()
      this.links.delete(name)
    }
    for (const entry of wanted) {
      const publication: Publication = {
        label: instanceLabel(this.advert().name, this.suffix),
        advert: this.advert(),
        port: target.port,
        addresses: entry.addresses,
      }
      const existing = this.links.get(entry.name)
      if (existing) {
        existing.publication = publication
        continue
      }
      try {
        const link = await (this.options.link ?? nativeLink)(
          entry.join,
          (packet) => this.receive(entry.name, packet),
          (error) => this.fail(error),
        )
        // Stopped or restarted while the socket was opening: do not leave it behind.
        if (generation !== this.generation || !this.target) {
          link.close()
          return
        }
        this.links.set(entry.name, { link, publication })
      } catch (error) {
        this.fail(error)
      }
    }
    this.announce(TTL_SECONDS)
    this.options.onChange?.()
  }

  private fail(error: unknown) {
    this.error = (error as NodeJS.ErrnoException)?.code ?? 'FAILED'
    this.options.onChange?.()
  }

  private send(entry: { link: MulticastLink; publication: Publication }, ttl: number) {
    try {
      entry.link.send(encodeResponse(publicationRecords(entry.publication, ttl)))
    } catch (error) {
      this.fail(error)
    }
  }

  /** Two announcements a second apart, as multicast DNS recommends, so one lost packet does not hide the host. */
  private announce(ttl: number) {
    for (const entry of this.links.values()) this.send(entry, ttl)
    if (ttl === 0) return
    const generation = this.generation
    setTimeout(() => {
      if (generation === this.generation) for (const entry of this.links.values()) this.send(entry, ttl)
    }, 1000).unref?.()
  }

  private receive(interfaceName: string, packet: Uint8Array) {
    const entry = this.links.get(interfaceName)
    if (!entry) return
    const message = decodeMessage(packet)
    if (!message) return
    if (conflictsWith(message, entry.publication)) {
      // Another host already uses this name: take the next free one and announce it.
      this.suffix = Math.min(this.suffix + 1, 20)
      void this.publish()
      return
    }
    if (!asks(message, entry.publication)) return
    const now = (this.options.now ?? Date.now)()
    this.responses = this.responses.filter((at) => now - at < 1000)
    if (this.responses.length >= MAX_RESPONSES_PER_SECOND) return
    this.responses.push(now)
    // A short random delay keeps several hosts from answering the same question in the same instant.
    const delay = 20 + Math.floor((this.options.random ?? Math.random)() * 100)
    setTimeout(() => {
      const current = this.links.get(interfaceName)
      if (current) this.send(current, TTL_SECONDS)
    }, delay).unref?.()
  }

  /** Withdraws the advertisement (goodbye packets) and closes every socket. */
  async stop(): Promise<void> {
    clearInterval(this.timer)
    this.timer = undefined
    this.generation++
    const links = [...this.links.values()]
    this.links.clear()
    for (const entry of links) {
      this.send(entry, 0)
      // The goodbye is queued before the socket closes.
      setTimeout(() => entry.link.close(), 50).unref?.()
    }
    const changed = this.target !== null
    this.target = null
    this.error = null
    if (changed) this.options.onChange?.()
  }
}
