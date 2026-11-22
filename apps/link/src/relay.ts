// The relay's HTTP API and sweep, over a Store and a Cloudflare client, so the same code runs in the Durable Object and
// in tests. Every host request is scoped to the signed-in account: a host can only ever act on its own account's slot.
import { linkHostname, type LinkPool, type LinkReply } from '@ramu/shared/ramuLink'
import type { Cloudflare } from './cloudflare'
import {
  TUNNEL_PREFIX,
  SEEN_EVERY_MS,
  admission,
  countUsage,
  ingressFor,
  judgeIdle,
  judgeTunnels,
  newSlot,
  promoteWaiting,
  releasesAt,
  rollMonth,
  type Slot,
  type Store,
} from './pool'
import { bearerOf, linkRequest, parseHostId, readJson } from './validate'

const DAY_MS = 24 * 60 * 60_000
/**
 * How long a verified session is trusted for a host's own housekeeping (seen, offline, release) before the account
 * service is asked again. A request for a tunnel always asks, so a signed-out or deleted account gets no new token.
 */
export const SESSION_CACHE_MS = 5 * 60_000
/** A sweep's budget, under the five-minute cron interval, and the most tunnels it deletes. */
const SWEEP_MS = 2 * 60_000
const SWEEP_DELETIONS = 100

export interface RelayDeps {
  store: Store
  cf: Cloudflare
  capacity: number
  zone: string
  /** Asks the account service who a session belongs to; null when it is not a valid session. */
  account(token: string): Promise<string | null>
  now(): number
  slug(): string
}

export interface SweepSummary {
  listed: number
  deleted: number
  warned: number
  released: number
  promoted: number
  suspended: number
  counted: boolean
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const refuse = (reason: string, status: number) => json({ state: 'unavailable', reason } satisfies LinkReply, status)

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createRelay(deps: RelayDeps) {
  const { store, cf } = deps
  const hostnameOf = (slot: Slot) => linkHostname(slot.slug, deps.zone)
  /** One request per account at a time, so two quick requests from one host never make two tunnels. */
  const running = new Map<string, Promise<unknown>>()
  const serial = <T>(userId: string, work: () => Promise<T>): Promise<T> => {
    const next = (running.get(userId) ?? Promise.resolve()).then(work, work)
    running.set(
      userId,
      next.catch(() => undefined),
    )
    return next
  }

  async function userOf(request: Request, fresh: boolean): Promise<string | null> {
    const token = bearerOf(request.headers.get('Authorization'))
    if (!token) return null
    const hash = await sha256(token)
    const cached = store.session(hash, deps.now())
    if (cached && !fresh) return cached
    const userId = await deps.account(token)
    // A session the account service no longer knows stops working here at once.
    if (userId) store.putSession(hash, userId, deps.now() + SESSION_CACHE_MS)
    else if (cached) store.putSession(hash, cached, deps.now())
    return userId
  }

  function pool(): LinkPool {
    return { capacity: deps.capacity, used: store.slots().length, waiting: store.waiting().length }
  }

  async function removeTunnel(slot: Slot): Promise<Slot> {
    if (!slot.tunnelId) return slot
    await cf.deleteTunnel(slot.tunnelId)
    store.setDownSince(slot.tunnelId, null)
    const next = { ...slot, tunnelId: null }
    store.putSlot(next)
    return next
  }

  async function release(slot: Slot) {
    const cleared = await removeTunnel(slot)
    if (cleared.dnsRecordId) await cf.deleteRecord(cleared.dnsRecordId)
    store.deleteSlot(slot.userId)
  }

  /** Makes sure an admitted host has a tunnel to its loopback port and a CNAME, and hands it the token. */
  async function connect(held: Slot, port: number, https: boolean, name: string): Promise<LinkReply> {
    const now = deps.now()
    let slot = rollMonth(held, now)
    if (slot.suspendedUntil !== null) {
      store.putSlot(slot)
      return { state: 'suspended', until: slot.suspendedUntil, usage: { bytes: slot.bytes, countedAt: slot.countedAt } }
    }
    const hostname = hostnameOf(slot)
    const created = !slot.tunnelId
    if (created) {
      slot = { ...slot, tunnelId: await cf.createTunnel(`${TUNNEL_PREFIX}${slot.slug}`) }
      // Saved straight away: a failure below leaves a tunnel the slot owns, not an orphan.
      store.putSlot(slot)
    }
    const tunnelId = slot.tunnelId!
    if (created || slot.port !== port || slot.https !== https)
      await cf.putIngress(tunnelId, ingressFor(hostname, port, https))
    if (created || !slot.dnsRecordId) {
      slot = { ...slot, dnsRecordId: await cf.putCname(hostname, `${tunnelId}.cfargotunnel.com`, slot.dnsRecordId) }
    }
    const token = await cf.tunnelToken(tunnelId)
    slot = { ...slot, port, https, hostName: name, lastOnlineAt: now }
    store.setDownSince(tunnelId, null)
    store.putSlot(slot)
    return {
      state: 'active',
      hostname,
      token,
      releasesAt: releasesAt(slot),
      usage: { bytes: slot.bytes, countedAt: slot.countedAt },
    }
  }

  async function ensure(request: Request, userId: string): Promise<Response> {
    const parsed = linkRequest.safeParse(await readJson(request))
    if (!parsed.success) return refuse('invalid-request', 400)
    const { hostId, name, port, https } = parsed.data
    return serial(userId, async () => {
      const now = deps.now()
      const decision = admission(store, userId, hostId, deps.capacity)
      if (decision.kind === 'taken')
        return json({ state: 'taken', hostName: decision.hostName } satisfies LinkReply, 409)
      if (decision.kind === 'wait') {
        if (!store.waiting().some((entry) => entry.userId === userId))
          store.putWaiting({ userId, hostId, hostName: name, since: now, promotedAt: null })
        return json({ state: 'waitlisted', position: decision.position, capacity: deps.capacity } satisfies LinkReply)
      }
      let slot = decision.kind === 'slot' ? decision.slot : null
      if (!slot) {
        slot = newSlot(userId, hostId, name, deps.slug(), now)
        store.deleteWaiting(userId)
        store.putSlot(slot)
      }
      try {
        const reply = await connect(slot, port, https, name)
        return json(reply, reply.state === 'suspended' ? 403 : 200)
      } catch (error) {
        console.error('link: could not connect', (error as Error).message)
        return refuse('relay-error', 503)
      }
    })
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] !== 'v1') return refuse('not-found', 404)
    if (request.method === 'GET' && parts[1] === 'pool' && parts.length === 2)
      return json(pool(), 200, { 'Cache-Control': 'public, max-age=60' })
    if (parts[1] !== 'links') return refuse('not-found', 404)
    let userId: string | null
    try {
      userId = await userOf(request, request.method === 'POST' && parts.length === 2)
    } catch {
      return refuse('account-unreachable', 503)
    }
    if (!userId) return refuse('signed-out', 401)
    if (request.method === 'POST' && parts.length === 2) return ensure(request, userId)
    const hostId = parseHostId(parts[2] ?? '')
    if (!hostId) return refuse('invalid-request', 400)
    const owner = userId
    return serial(owner, async () => {
      const slot = store.slotOf(owner)
      const mine = slot?.hostId === hostId ? slot : null
      if (request.method === 'DELETE' && parts.length === 3) {
        if (mine) await release(mine)
        store.deleteWaiting(owner)
        return new Response(null, { status: 204 })
      }
      if (!mine) return refuse('no-link', 404)
      if (request.method === 'DELETE' && parts[3] === 'online' && parts.length === 4) {
        await removeTunnel(mine)
        return new Response(null, { status: 204 })
      }
      if (request.method === 'POST' && parts[3] === 'seen' && parts.length === 4) {
        const now = deps.now()
        if (now - mine.seenReportedAt >= SEEN_EVERY_MS)
          store.putSlot({ ...mine, lastSeenAt: now, seenReportedAt: now, warnedAt: null })
        return new Response(null, { status: 204 })
      }
      return refuse('not-found', 404)
    })
  }

  /** The five-minute sweep: tunnels first, then idle slots, the waitlist and, once a day, traffic. */
  async function sweep(): Promise<SweepSummary> {
    const started = deps.now()
    const deadline = Date.now() + SWEEP_MS
    const summary: SweepSummary = {
      listed: 0,
      deleted: 0,
      warned: 0,
      released: 0,
      promoted: 0,
      suspended: 0,
      counted: false,
    }
    const budget = () => summary.deleted < SWEEP_DELETIONS && Date.now() < deadline
    try {
      const tunnels = await cf.listTunnels(TUNNEL_PREFIX, deadline)
      summary.listed = tunnels.length
      const verdict = judgeTunnels(store, tunnels, started)
      for (const mark of verdict.down) store.setDownSince(mark.id, mark.since)
      for (const doomed of verdict.delete) {
        if (!budget()) break
        const owner = store.slots().find((slot) => slot.tunnelId === doomed.id)
        if (owner) await removeTunnel(owner)
        else await cf.deleteTunnel(doomed.id)
        summary.deleted++
      }
    } catch (error) {
      console.error('link: tunnel sweep failed', (error as Error).message)
    }
    const idle = judgeIdle(store, started)
    for (const userId of idle.warn) {
      const slot = store.slotOf(userId)
      if (slot) store.putSlot({ ...slot, warnedAt: started })
      summary.warned++
    }
    for (const userId of idle.release) {
      const slot = store.slotOf(userId)
      if (!slot || !budget()) continue
      try {
        await release(slot)
        summary.released++
        summary.deleted++
      } catch (error) {
        console.error('link: release failed', (error as Error).message)
      }
    }
    summary.promoted = promoteWaiting(store, deps.capacity, started).promoted
    const lastCount = store.meta('usage_at')
    if (lastCount === null || started - lastCount >= DAY_MS) {
      // Recorded first, so a failing analytics query is retried tomorrow rather than every five minutes.
      store.setMeta('usage_at', started)
      try {
        const from = Math.max(lastCount ?? started - DAY_MS, started - DAY_MS)
        const counts = await cf.bytesByHost(store.slots().map(hostnameOf), from, started)
        for (const slot of countUsage(store, counts, hostnameOf, started)) {
          await removeTunnel(slot).catch(() => undefined)
          summary.suspended++
        }
        summary.counted = true
      } catch (error) {
        console.error('link: traffic count skipped', (error as Error).message)
      }
    }
    return summary
  }

  return { handle, sweep, pool }
}
