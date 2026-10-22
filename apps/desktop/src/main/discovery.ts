// Nearby-host browsing for the desktop app. It runs in the main process on this computer, never on the host the window
// shows, starts only when the Connect-to-a-host panel asks and stops when it is closed, left, or the time limit passes.
// It only lists what it hears: an advertisement never pairs, sends a credential or changes a saved host.
import { createSocket, type RemoteInfo, type Socket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { MAX_BROWSE_MS } from '@ramu/shared/discovery/contract'
import { SERVICE_NAME, DnsSdCollector } from '@ramu/shared/discovery/browse'
import { MDNS_ADDRESS, MDNS_PORT, TYPE, decodeMessage, encodeQuery } from '@ramu/shared/discovery/mdns'
import { DiscoveryTracker, type NearbyHostsState } from '@ramu/shared/discovery/tracker'

export type NearbyState = NearbyHostsState
type NearbyStatus = NearbyHostsState['status']

export interface BrowseLink {
  send(packet: Uint8Array, interfaceAddress: string): void
  close(): void
}
export type BrowseLinkFactory = (
  interfaceAddresses: string[],
  onPacket: (packet: Uint8Array, from: string) => void,
  onError: (error: NodeJS.ErrnoException) => void,
) => Promise<BrowseLink>

type Interfaces = ReturnType<typeof networkInterfaces>

const ownAddresses = (interfaces: Interfaces) =>
  new Set(Object.values(interfaces).flatMap((entries) => (entries ?? []).map((entry) => entry.address)))

/** The IPv4 interfaces a browse uses: up, not loopback, with an address that is not link-local. */
export function browseInterfaces(
  interfaces: Interfaces = networkInterfaces(),
): { name: string; address: string; netmask: string }[] {
  const found: { name: string; address: string; netmask: string }[] = []
  for (const [name, entries] of Object.entries(interfaces))
    for (const entry of entries ?? [])
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.'))
        found.push({ name, address: entry.address, netmask: entry.netmask })
  return found
}

const ipv4 = (value: string) => value.split('.').reduce((total, part) => (total << 8) + Number(part), 0) >>> 0
/** Which interface a reply came from, by subnet; the platform does not say. */
export function interfaceFor(
  from: string,
  interfaces: { name: string; address: string; netmask: string }[],
): string | undefined {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(from)) return undefined
  return interfaces.find(
    (entry) =>
      /^\d+\.\d+\.\d+\.\d+$/.test(entry.netmask) &&
      (ipv4(from) & ipv4(entry.netmask)) === (ipv4(entry.address) & ipv4(entry.netmask)),
  )?.name
}

export const nativeBrowseLink: BrowseLinkFactory = (interfaceAddresses, onPacket, onError) =>
  new Promise((resolve, reject) => {
    const socket: Socket = createSocket({ type: 'udp4', reuseAddr: true })
    socket.once('error', reject)
    socket.on('message', (message, remote: RemoteInfo) =>
      onPacket(new Uint8Array(message.buffer, message.byteOffset, message.byteLength), remote.address),
    )
    socket.bind(MDNS_PORT, () => {
      try {
        socket.off('error', reject)
        socket.on('error', onError)
        for (const address of interfaceAddresses) {
          try {
            socket.addMembership(MDNS_ADDRESS, address)
          } catch {
            // One interface that cannot join (a down VPN) must not stop the others.
          }
        }
        socket.setMulticastTTL(255)
        socket.setMulticastLoopback(false)
        resolve({
          send: (packet, interfaceAddress) => {
            try {
              socket.setMulticastInterface(interfaceAddress)
              socket.send(packet, MDNS_PORT, MDNS_ADDRESS, (error) => error && onError(error as NodeJS.ErrnoException))
            } catch (error) {
              onError(error as NodeJS.ErrnoException)
            }
          },
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

const DENIED = new Set(['EPERM', 'EACCES', 'EHOSTUNREACH', 'ENETUNREACH'])
const QUERY_DELAYS_MS = [0, 1000, 3000, 9000, 30_000, 60_000]

export class NearbyBrowser {
  private tracker: DiscoveryTracker
  private collector = new DnsSdCollector()
  private session = 0
  private link: BrowseLink | null = null
  private status: NearbyStatus = 'idle'
  private timedOut = false
  private timers: ReturnType<typeof setTimeout>[] = []
  private interfaces: { name: string; address: string; netmask: string }[] = []
  private own = new Set<string>()

  constructor(
    private readonly options: {
      link?: BrowseLinkFactory
      interfaces?: () => Interfaces
      /** Called whenever the list or status changes, for pushing to the window. */
      changed?: () => void
      /** The saved host a pairing bound to this advertised id; a recognition hint, never a credential decision. */
      verifiedHost?: (hostId: string) => string | null
      limitMs?: number
    } = {},
  ) {
    this.tracker = new DiscoveryTracker(options.verifiedHost ? { verifiedHost: options.verifiedHost } : {})
  }

  state(): NearbyState {
    return { status: this.status, hosts: this.status === 'idle' ? [] : this.tracker.hosts(), timedOut: this.timedOut }
  }

  /** Starts (or restarts) browsing. A second call while searching begins a fresh browse, like Retry. */
  async start(): Promise<NearbyState> {
    this.halt()
    const session = this.tracker.begin()
    this.session = session
    this.collector = new DnsSdCollector()
    this.timedOut = false
    const all = this.options.interfaces?.() ?? networkInterfaces()
    this.interfaces = browseInterfaces(all)
    this.own = ownAddresses(all)
    if (!this.interfaces.length) {
      this.status = 'unavailable'
      this.options.changed?.()
      return this.state()
    }
    this.status = 'searching'
    try {
      const link = await (this.options.link ?? nativeBrowseLink)(
        this.interfaces.map((entry) => entry.address),
        (packet, from) => this.receive(session, packet, from),
        (error) => this.fail(session, error),
      )
      // Closed or restarted while the socket was opening.
      if (!this.tracker.accepts(session)) {
        link.close()
        return this.state()
      }
      this.link = link
    } catch (error) {
      this.fail(session, error as NodeJS.ErrnoException)
      return this.state()
    }
    for (const delay of QUERY_DELAYS_MS)
      this.timers.push(setTimeout(() => this.ask(session, [{ name: SERVICE_NAME, type: TYPE.PTR }]), delay))
    this.timers.push(setInterval(() => this.tick(session), 2000) as unknown as ReturnType<typeof setTimeout>)
    this.timers.push(
      setTimeout(() => {
        if (!this.tracker.accepts(session)) return
        this.halt()
        this.timedOut = true
        this.status = 'idle'
        this.options.changed?.()
      }, this.options.limitMs ?? MAX_BROWSE_MS),
    )
    this.options.changed?.()
    return this.state()
  }

  private ask(session: number, questions: { name: string; type: number }[]) {
    if (!this.tracker.accepts(session) || !this.link) return
    const packet = encodeQuery(questions)
    for (const entry of this.interfaces) this.link.send(packet, entry.address)
  }

  private receive(session: number, packet: Uint8Array, from: string) {
    if (!this.tracker.accepts(session) || this.own.has(from)) return
    const message = decodeMessage(packet)
    if (!message) return
    const update = this.collector.ingest(message, interfaceFor(from, this.interfaces))
    let changed = false
    for (const sighting of update.sightings)
      if (!this.own.has(sighting.endpoint.address)) changed = this.tracker.observe(session, sighting) || changed
    for (const key of update.lost) changed = this.tracker.lose(session, key) || changed
    if (update.followUps.length) this.ask(session, update.followUps.slice(0, 8))
    if (changed) this.options.changed?.()
  }

  private tick(session: number) {
    if (this.tracker.accepts(session) && this.tracker.expire()) this.options.changed?.()
  }

  private fail(session: number, error: NodeJS.ErrnoException) {
    if (session !== this.session) return
    this.halt()
    this.status = DENIED.has(error.code ?? '') ? 'denied' : 'unavailable'
    this.options.changed?.()
  }

  private halt() {
    for (const timer of this.timers) {
      clearTimeout(timer)
      clearInterval(timer)
    }
    this.timers = []
    this.link?.close()
    this.link = null
    this.tracker.close()
  }

  /** Leaves nothing running and nothing listed. Safe to call repeatedly. */
  stop(): NearbyState {
    this.halt()
    this.status = 'idle'
    this.timedOut = false
    this.session++
    this.options.changed?.()
    return this.state()
  }
}
