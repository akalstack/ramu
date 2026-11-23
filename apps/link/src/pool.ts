// The relay's decisions, with no Workers or Cloudflare APIs: who gets a slot, who waits, which tunnels a sweep deletes,
// which slots are released or suspended. The Durable Object and the tests both drive these through a Store.
import { LINK_LIMITS } from '@ramu/shared/ramuLink'

const DAY_MS = 24 * 60 * 60_000
/** A tunnel that never connected is deleted once it is this old: its host asked and then never ran it. */
export const NEVER_CONNECTED_MS = 60 * 60_000
/** A host reporting device use counts once per this long, so a chatty host cannot keep the store busy. */
export const SEEN_EVERY_MS = 60 * 60_000
/** A waitlisted host that was offered a slot and did not take it within this long loses its place. */
export const PROMOTION_EXPIRES_MS = DAY_MS
/** Tunnels the relay owns are named with this, so a sweep never touches the account's other tunnels. */
export const TUNNEL_PREFIX = 'ramu-link-'

export interface Slot {
  userId: string
  hostId: string
  hostName: string
  /** Stable per slot: the address ramu-<slug> survives tunnel recreation. */
  slug: string
  tunnelId: string | null
  dnsRecordId: string | null
  port: number
  https: boolean
  createdAt: number
  /** The idle clock: the last time a paired device reached the host through the link. */
  lastSeenAt: number
  seenReportedAt: number
  lastOnlineAt: number
  warnedAt: number | null
  suspendedUntil: number | null
  bytes: number
  countedAt: number
}

export interface Waiting {
  userId: string
  hostId: string
  hostName: string
  since: number
  promotedAt: number | null
}

/** Synchronous storage, as a Durable Object's SQLite gives it. */
export interface Store {
  slotOf(userId: string): Slot | null
  slots(): Slot[]
  putSlot(slot: Slot): void
  deleteSlot(userId: string): void
  waiting(): Waiting[]
  putWaiting(entry: Waiting): void
  deleteWaiting(userId: string): void
  session(hash: string, now: number): string | null
  putSession(hash: string, userId: string, expiresAt: number): void
  downSince(tunnelId: string): number | null
  setDownSince(tunnelId: string, at: number | null): void
  meta(key: string): number | null
  setMeta(key: string, value: number): void
}

export type Admission =
  | { kind: 'slot'; slot: Slot }
  | { kind: 'taken'; hostName: string }
  | { kind: 'admit' }
  | { kind: 'wait'; position: number }

/**
 * Hosts online through the relay: each holds one Cloudflare Tunnel and one DNS record, which is what the account's
 * limits count. A slot whose host is offline keeps only its address, which costs neither.
 */
export function online(store: Store): number {
  return store.slots().filter((slot) => slot.tunnelId !== null).length
}

/**
 * Whether a host may come online. Capacity counts hosts online at once, so an account keeps its address while its host
 * is off and only needs room again to reconnect. The waitlist is first come, first served, for newcomers and returning
 * hosts alike: a waiting host comes online once the free room reaches its place, and anyone else only when the free
 * room outnumbers everyone waiting. A host already online, or one paused for its traffic (which gets no tunnel), always
 * gets its slot back.
 */
export function admission(store: Store, userId: string, hostId: string, capacity: number, now: number): Admission {
  const held = store.slotOf(userId)
  if (held && held.hostId !== hostId) return { kind: 'taken', hostName: held.hostName }
  if (held && (held.tunnelId !== null || (held.suspendedUntil !== null && held.suspendedUntil > now)))
    return { kind: 'slot', slot: held }
  const free = capacity - online(store)
  const queue = store.waiting()
  const index = queue.findIndex((entry) => entry.userId === userId)
  const admitted = index >= 0 ? index < free : free > queue.length
  if (!admitted) return { kind: 'wait', position: index >= 0 ? index + 1 : queue.length + 1 }
  return held ? { kind: 'slot', slot: held } : { kind: 'admit' }
}

export function newSlot(userId: string, hostId: string, hostName: string, slug: string, now: number): Slot {
  return {
    userId,
    hostId,
    hostName,
    slug,
    tunnelId: null,
    dnsRecordId: null,
    port: 0,
    https: false,
    createdAt: now,
    lastSeenAt: now,
    seenReportedAt: 0,
    lastOnlineAt: now,
    warnedAt: null,
    suspendedUntil: null,
    bytes: 0,
    countedAt: now,
  }
}

/** The day an unused address is released. */
export function releasesAt(slot: Slot): number {
  return slot.lastSeenAt + LINK_LIMITS.idleReleaseDays * DAY_MS
}

/** Midnight UTC on the first of the month after `now`, when a suspension ends and the count starts again. */
export function nextMonth(now: number): number {
  const date = new Date(now)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
}

/** Clears last month's count and an ended suspension. */
export function rollMonth(slot: Slot, now: number): Slot {
  const counted = new Date(slot.countedAt),
    today = new Date(now)
  const sameMonth = counted.getUTCFullYear() === today.getUTCFullYear() && counted.getUTCMonth() === today.getUTCMonth()
  return {
    ...slot,
    bytes: sameMonth ? slot.bytes : 0,
    countedAt: sameMonth ? slot.countedAt : now,
    suspendedUntil: slot.suspendedUntil !== null && slot.suspendedUntil > now ? slot.suspendedUntil : null,
  }
}

/** The tunnel ingress: only this host's loopback listener, and 404 for anything else. */
export function ingressFor(hostname: string, port: number, https: boolean) {
  return [
    {
      hostname,
      service: `${https ? 'https' : 'http'}://localhost:${port}`,
      ...(https ? { originRequest: { noTLSVerify: true } } : {}),
    },
    { service: 'http_status:404' },
  ]
}

/** A tunnel as Cloudflare lists it. */
export interface ListedTunnel {
  id: string
  name: string
  status: 'inactive' | 'down' | 'degraded' | 'healthy' | string
  createdAt: number
  /** When it last had a connection; null for one that never connected. */
  connectedAt: number | null
}

export interface TunnelVerdict {
  delete: { id: string; reason: 'offline' | 'never-connected' | 'orphan' }[]
  down: { id: string; since: number | null }[]
}

/**
 * Which of the relay's tunnels to delete. A connected tunnel clears its down mark. One down for the offline limit, one
 * that never connected within an hour, and one no slot owns any more are deleted; the slot and its address stay.
 */
export function judgeTunnels(store: Store, tunnels: ListedTunnel[], now: number): TunnelVerdict {
  const owned = new Set(store.slots().map((slot) => slot.tunnelId))
  const verdict: TunnelVerdict = { delete: [], down: [] }
  for (const tunnel of tunnels) {
    if (!tunnel.name.startsWith(TUNNEL_PREFIX)) continue
    const old = now - tunnel.createdAt >= NEVER_CONNECTED_MS
    if (!owned.has(tunnel.id)) {
      if (old) verdict.delete.push({ id: tunnel.id, reason: 'orphan' })
      continue
    }
    if (tunnel.status === 'healthy' || tunnel.status === 'degraded') {
      if (store.downSince(tunnel.id) !== null) verdict.down.push({ id: tunnel.id, since: null })
      continue
    }
    if (tunnel.connectedAt === null) {
      if (old) verdict.delete.push({ id: tunnel.id, reason: 'never-connected' })
      continue
    }
    const since = store.downSince(tunnel.id)
    if (since === null) verdict.down.push({ id: tunnel.id, since: now })
    else if (now - since >= LINK_LIMITS.offlineReleaseMs) verdict.delete.push({ id: tunnel.id, reason: 'offline' })
  }
  return verdict
}

export interface IdleVerdict {
  warn: string[]
  release: string[]
}

/** Slots whose address no device has used: warned at idleWarnDays, released at idleReleaseDays. */
export function judgeIdle(store: Store, now: number): IdleVerdict {
  const verdict: IdleVerdict = { warn: [], release: [] }
  for (const slot of store.slots()) {
    const idle = now - slot.lastSeenAt
    if (idle >= LINK_LIMITS.idleReleaseDays * DAY_MS) verdict.release.push(slot.userId)
    else if (idle >= LINK_LIMITS.idleWarnDays * DAY_MS && slot.warnedAt === null) verdict.warn.push(slot.userId)
  }
  return verdict
}

/**
 * Marks the waiting hosts that free room now admits, and drops those offered it a day ago that never came back for it
 * (the host is gone), so the next in line moves up.
 */
export function promoteWaiting(store: Store, capacity: number, now: number): { promoted: number; dropped: number } {
  let dropped = 0
  for (const entry of store.waiting())
    if (entry.promotedAt !== null && now - entry.promotedAt >= PROMOTION_EXPIRES_MS) {
      store.deleteWaiting(entry.userId)
      dropped++
    }
  const free = Math.max(0, capacity - online(store))
  let promoted = 0
  for (const entry of store.waiting().slice(0, free))
    if (entry.promotedAt === null) {
      store.putWaiting({ ...entry, promotedAt: now })
      promoted++
    }
  return { promoted, dropped }
}

/** Adds a day's bytes to each slot by hostname and names the slots now over the month's limit. */
export function countUsage(
  store: Store,
  bytesByHost: Map<string, number>,
  hostnameOf: (slot: Slot) => string,
  now: number,
) {
  const over: Slot[] = []
  for (const current of store.slots()) {
    const slot = rollMonth(current, now)
    const added = bytesByHost.get(hostnameOf(slot)) ?? 0
    const next = { ...slot, bytes: slot.bytes + added, countedAt: now }
    if (next.bytes >= LINK_LIMITS.monthlyBytes && next.suspendedUntil === null) {
      next.suspendedUntil = nextMonth(now)
      over.push(next)
    }
    store.putSlot(next)
  }
  return over
}
