// The state a device keeps while it browses for nearby hosts: bounded, expiring, and fenced by session so a callback
// that arrives after the dialog closed or Retry was pressed cannot change what is shown. Pure; native code and sockets
// live in the desktop main process and the mobile native module and only feed sightings in.
import { MAX_DISCOVERY_HOSTS, endpointUrl, type DiscoveryAdvert, type Endpoint } from './contract'

export interface Sighting {
  /** Unique per advertised instance and network interface, so a goodbye removes exactly what it announced. */
  key: string
  advert: DiscoveryAdvert
  endpoint: Endpoint
  ttlMs: number
  /** Name of the network interface the answer came from, when the platform says. */
  interfaceName?: string
}

export interface NearbyRoute {
  url: string
  interfaceName: string | null
}

export interface NearbyHost {
  /** Stable while the host stays visible: identifier, name and transport together. */
  key: string
  hostId: string
  name: string
  /** `name`, plus a short identifier when another visible host has the same name. */
  label: string
  scheme: 'http' | 'https'
  /** First usable route; the others are the same host seen on another interface. */
  routes: NearbyRoute[]
  /** The saved host this advertisement is verified to belong to. Null today: an advertisement alone verifies nothing. */
  pairedHostId: string | null
}

/** What a device shows while it browses. `denied` is a platform refusal (local-network permission); `unavailable` is anything else. */
export interface NearbyHostsState {
  status: 'idle' | 'searching' | 'denied' | 'unavailable'
  hosts: NearbyHost[]
  /** True once the browse stopped by itself at its time limit; the panel offers Retry. */
  timedOut: boolean
}

const MAX_SIGHTINGS = 200
const MAX_TTL_MS = 5 * 60_000
const MIN_TTL_MS = 5_000

interface Stored extends Sighting {
  expiresAt: number
  seen: number
}

export class DiscoveryTracker {
  private session = 0
  private open = false
  private seen = 0
  private sightings = new Map<string, Stored>()

  constructor(
    private readonly options: {
      now?: () => number
      /** Maps an advertised identifier to a saved host id only when that identity has been verified. */
      verifiedHost?: (hostId: string) => string | null
    } = {},
  ) {}

  private now() {
    return this.options.now?.() ?? Date.now()
  }

  /** Starts a fresh browse and returns its token. Anything from an earlier token is ignored from now on. */
  begin(): number {
    this.sightings.clear()
    this.open = true
    return ++this.session
  }

  /** Stops accepting results; the last list is cleared because stale hosts must not look reachable. */
  close(): void {
    this.open = false
    this.session++
    this.sightings.clear()
  }

  accepts(session: number): boolean {
    return this.open && session === this.session
  }

  /** Records or refreshes one sighting. Returns whether the visible list may have changed. */
  observe(session: number, sighting: Sighting): boolean {
    if (!this.accepts(session)) return false
    if (!endpointUrl(sighting.endpoint)) return false
    const ttl = Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, sighting.ttlMs))
    if (this.sightings.size >= MAX_SIGHTINGS && !this.sightings.has(sighting.key)) {
      const oldest = [...this.sightings.values()].sort((a, b) => a.seen - b.seen)[0]
      if (oldest) this.sightings.delete(oldest.key)
    }
    this.sightings.set(sighting.key, { ...sighting, ttlMs: ttl, expiresAt: this.now() + ttl, seen: ++this.seen })
    return true
  }

  /** A goodbye (TTL 0) or a platform "service lost" callback. */
  lose(session: number, key: string): boolean {
    return this.accepts(session) && this.sightings.delete(key)
  }

  expire(): boolean {
    const now = this.now()
    let changed = false
    for (const [key, sighting] of this.sightings)
      if (sighting.expiresAt <= now) {
        this.sightings.delete(key)
        changed = true
      }
    return changed
  }

  /**
   * Visible hosts. Sightings merge into one row only when identifier, name and transport all agree: a second device
   * that copies an identifier but not the rest stays a separate row rather than adding a route to the real host.
   */
  hosts(): NearbyHost[] {
    this.expire()
    const groups = new Map<string, Stored[]>()
    for (const sighting of this.sightings.values()) {
      const { hostId, name, scheme } = sighting.advert
      const key = `${hostId}|${name}|${scheme}`
      groups.set(key, [...(groups.get(key) ?? []), sighting])
    }
    const rows: NearbyHost[] = [...groups.entries()].map(([key, members]) => {
      const first = members[0]!.advert
      const routes: NearbyRoute[] = []
      for (const member of members.sort((a, b) => a.key.localeCompare(b.key))) {
        const url = endpointUrl(member.endpoint)
        if (url && !routes.some((route) => route.url === url))
          routes.push({ url, interfaceName: member.interfaceName ?? null })
      }
      return {
        key,
        hostId: first.hostId,
        name: first.name,
        label: first.name,
        scheme: first.scheme,
        routes,
        pairedHostId: this.options.verifiedHost?.(first.hostId) ?? null,
      }
    })
    const names = new Map<string, number>()
    for (const row of rows) names.set(row.name, (names.get(row.name) ?? 0) + 1)
    return rows
      .map((row) => (names.get(row.name)! > 1 ? { ...row, label: `${row.name} (${row.hostId.slice(0, 4)})` } : row))
      .sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key))
      .slice(0, MAX_DISCOVERY_HOSTS)
  }

  /**
   * Whether a row the person selected still stands for the same route. A selected row survives refreshes by key; if its
   * address changed, or it vanished, the form must be re-checked before pairing continues.
   */
  selection(key: string | null, url: string | null): SelectionReview {
    return reviewSelection(this.hosts(), key, url)
  }
}

export type SelectionReview = 'none' | 'same' | 'changed' | 'gone'

/** The same check for a list a device already holds (the panel polls a state, not the tracker). */
export function reviewSelection(hosts: readonly NearbyHost[], key: string | null, url: string | null): SelectionReview {
  if (!key) return 'none'
  const row = hosts.find((host) => host.key === key)
  if (!row) return 'gone'
  return url && row.routes.some((route) => route.url === url) ? 'same' : 'changed'
}
