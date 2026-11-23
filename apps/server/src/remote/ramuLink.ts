// The host's side of Ramu Link: asks the relay for this host's tunnel, keeps its token in the credential store, waits on
// the list when every slot is taken, and tells the relay when the host goes away. The relay never sees a device token;
// it only hands out the tunnel, and every call through it still needs a paired device's token here.
import {
  LINK_LIMITS,
  LINK_URL,
  type LinkPool,
  type LinkReply,
  type LinkRequest,
  type LinkStatus,
} from '@ramu/shared/ramuLink'
import { SavedCredential } from '../workspace/forge/savedCredential'
import type { HostCredentialStore } from '../credentials/store'

const STATE_KEY = 'ramu-link'
const REQUEST_MS = 15_000
/** The pool changes slowly; Settings asks at most this often. */
const POOL_MS = 10 * 60_000
/** A device reaching the host through the link is reported at most this often. */
const SEEN_MS = 60 * 60_000
/** After the relay could not be reached or failed, it is asked again after this long, doubling up to the cap. */
export const RETRY_MS = 30_000
const RETRY_MAX_MS = 15 * 60_000

interface Saved {
  relay: string
  hostname: string | null
  releasesAt: number | null
}

export interface LinkLease {
  token: string
  url: string
}

export interface LinkHost {
  hostId: string
  hostName(): string
  /** The Ramu account session, or null when this host is signed out. */
  bearer(): Promise<string | null>
  getState<T>(key: string, fallback: T): T
  setState(key: string, value: unknown): void
  /** The link's state changed: Settings and the tunnel follow. */
  changed(): void
  /** Whether this host still runs Ramu Link; a later check asks the relay only while it does, so it never takes a slot. */
  wanted?(): boolean
  credentials?: HostCredentialStore
  fetch?: typeof fetch
}

/** A relay address the person typed: https, or http only on this computer, with no path. */
export function parseRelay(input: unknown): string {
  if (input === undefined || input === null || input === '') return LINK_URL
  let url: URL
  try {
    url = new URL(String(input).trim())
  } catch {
    throw new Error('Enter your relay address, such as https://link.example.com')
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new Error('Your relay needs an https:// address')
  if (url.pathname !== '/' || url.search || url.hash || url.username)
    throw new Error('Enter only the relay address, with no path')
  return url.origin
}

const blank = (relay: string): LinkStatus => ({
  state: 'unavailable',
  relay,
  hostname: null,
  position: null,
  until: null,
  releasesAt: null,
  usage: null,
  devices: 0,
  takenBy: null,
  reason: null,
})

export class LinkClient {
  private readonly token: SavedCredential<{ token: string; hostname: string }>
  private readonly fetcher: typeof fetch
  private current: LinkStatus
  private waitTimer?: ReturnType<typeof setTimeout>
  private retryMs = RETRY_MS
  /** What the tunnel last asked for, so a later check (a retry, a sign-in) asks for the same. */
  private asked: { relay: string; target: string } | null = null
  private rechecking = false
  /** A sign-in that arrived during a check, which may have read the session before it existed. */
  private recheckAgain = false
  private pooled: { relay: string; at: number; pool: LinkPool | null } | null = null
  private lastSeen = 0
  private connected = new Set<string>()

  constructor(private readonly host: LinkHost) {
    const get = (key: string, fallback: unknown) => host.getState(key, fallback) as never
    const set = (key: string, value: unknown) => host.setState(key, value)
    this.token = new SavedCredential(
      { key: 'ramu-link-token', connectionId: 'ramu-link-token', shown: 'hostname' },
      get,
      set,
      host.credentials,
    )
    this.fetcher = host.fetch ?? fetch
    const saved = this.saved()
    this.current = {
      ...blank(saved?.relay ?? LINK_URL),
      hostname: saved?.hostname ?? null,
      releasesAt: saved?.releasesAt ?? null,
    }
  }

  private saved(): Saved | null {
    return this.host.getState<Saved | null>(STATE_KEY, null)
  }

  status(): LinkStatus {
    return { ...this.current, devices: this.connected.size }
  }

  private set(next: LinkStatus) {
    this.current = next
    this.host.changed()
  }

  private async call<T>(
    relay: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
    const bearer = await this.host.bearer()
    if (!bearer) throw new SignedOut()
    const response = await this.fetcher(`${relay}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_MS),
    })
    const text = await response.text()
    return { status: response.status, body: (text ? JSON.parse(text) : null) as T }
  }

  /**
   * The tunnel to run for this host, or null when it has none (signed out, waiting for a slot, suspended). A token kept
   * from an earlier run is used straight away, so a restart reconnects without waiting for the relay; the relay is still
   * asked, and a changed answer replaces it.
   */
  async lease(relay: string, target: string): Promise<LinkLease | null> {
    clearTimeout(this.waitTimer)
    const saved = this.saved()
    const kept = saved?.relay === relay ? await this.token.read().catch(() => null) : null
    const asking = this.ask(relay, target)
    if (kept?.hostname) {
      // The relay's answer replaces the kept token when it differs, or ends the tunnel when the slot is gone.
      void asking
        .then((fresh) => {
          if (!fresh) {
            if (this.current.state !== 'active') this.onLease?.(null)
          } else if (fresh.token !== kept.token || fresh.url !== `https://${kept.hostname}`) this.onLease?.(fresh)
        })
        .catch(() => {})
      return { token: kept.token, url: `https://${kept.hostname}` }
    }
    return asking
  }

  private async ask(relay: string, target: string): Promise<LinkLease | null> {
    this.asked = { relay, target }
    const url = new URL(target)
    const request: LinkRequest = {
      hostId: this.host.hostId,
      name: this.host.hostName().slice(0, 80),
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
      https: url.protocol === 'https:',
    }
    let reply: LinkReply
    try {
      reply = (await this.call<LinkReply>(relay, 'POST', '/v1/links', request)).body
    } catch (error) {
      if (error instanceof SignedOut) {
        this.set({ ...blank(relay), state: 'signed-out' })
        return null
      }
      // Unreachable relay: a kept token goes on working, and the relay is asked again later.
      this.set({
        ...this.current,
        relay,
        state: this.current.state === 'active' ? 'active' : 'unavailable',
        reason: errorText(error),
      })
      if (this.current.state === 'unavailable') this.later(relay, target)
      return null
    }
    return this.take(relay, target, reply)
  }

  private async take(relay: string, target: string, reply: LinkReply): Promise<LinkLease | null> {
    const base = { ...blank(relay), hostname: this.current.hostname }
    if (reply.state === 'active') {
      this.retryMs = RETRY_MS
      await this.token.save({ token: reply.token, hostname: reply.hostname })
      this.host.setState(STATE_KEY, { relay, hostname: reply.hostname, releasesAt: reply.releasesAt } satisfies Saved)
      const changed = this.current.hostname !== reply.hostname || this.current.state !== 'active'
      this.current = {
        ...base,
        state: 'active',
        hostname: reply.hostname,
        releasesAt: reply.releasesAt,
        usage: reply.usage,
      }
      if (changed) this.host.changed()
      return { token: reply.token, url: `https://${reply.hostname}` }
    }
    await this.token.remove().catch(() => {})
    if (reply.state === 'waitlisted') {
      this.set({ ...base, state: 'waitlisted', position: reply.position })
      // Asked again later; the relay hands the next free slot to the host that asks first in line.
      this.waitTimer = setTimeout(() => void this.retry(relay, target), LINK_LIMITS.waitlistCheckMs)
      this.waitTimer.unref?.()
    } else if (reply.state === 'suspended')
      this.set({ ...base, state: 'suspended', until: reply.until, usage: reply.usage })
    else if (reply.state === 'taken')
      this.set({
        ...base,
        state: 'taken',
        takenBy: reply.hostName,
        holders: reply.hosts ?? [],
      })
    // An expired account session: signing in again here fixes it.
    else if (reply.reason === 'signed-out') this.set({ ...base, state: 'signed-out' })
    else {
      this.set({ ...base, state: 'unavailable', reason: reply.reason })
      this.later(relay, target)
    }
    return null
  }

  /** Asks again after the current back-off, doubling it for the next failure. */
  private later(relay: string, target: string) {
    clearTimeout(this.waitTimer)
    this.waitTimer = setTimeout(() => void this.retry(relay, target), this.retryMs)
    this.waitTimer.unref?.()
    this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS)
  }

  /**
   * The Ramu account on this host changed. A link waiting on a sign-in asks the relay straight away, rather than on the
   * next start, so Settings stops asking to sign in once the person has.
   */
  accountChanged(): void {
    if (this.rechecking) {
      this.recheckAgain = true
      return
    }
    if (this.current.state !== 'signed-out' || !this.asked) return
    clearTimeout(this.waitTimer)
    this.retryMs = RETRY_MS
    void this.retry(this.asked.relay, this.asked.target)
  }

  /** Set by the host: a slot found on a later check starts the tunnel, a changed one restarts it, null stops it. */
  onLease?: (lease: LinkLease | null) => void

  private async retry(relay: string, target: string) {
    if (this.asked?.relay !== relay || this.asked.target !== target || this.rechecking) return
    if (this.host.wanted && !this.host.wanted()) return
    this.rechecking = true
    try {
      const lease = await this.ask(relay, target).catch(() => null)
      if (lease) this.onLease?.(lease)
    } finally {
      this.rechecking = false
    }
    if (this.recheckAgain) {
      this.recheckAgain = false
      this.accountChanged()
    }
  }

  /** The host is stopping: the relay deletes the tunnel and keeps the address for next time. */
  async offline(): Promise<void> {
    clearTimeout(this.waitTimer)
    if (this.current.state !== 'active') return
    await this.call(this.current.relay, 'DELETE', `/v1/links/${this.host.hostId}/online`).catch(() => {})
  }

  /**
   * Gives back the link another of the account's hosts holds, from here, when every one is taken; then asks for this
   * host's own. Only a host the relay named as holding one, so a mistyped id never releases anything.
   */
  async releaseOther(hostId: string): Promise<void> {
    const holder = this.current.holders?.find((held) => held.hostId === hostId)
    if (this.current.state !== 'taken' || !holder) throw new Error('That host does not hold one of your links')
    const { status } = await this.call(this.current.relay, 'DELETE', `/v1/links/${hostId}`)
    if (status !== 204) throw new Error(`Ramu Link answered ${status}`)
    if (this.asked) {
      clearTimeout(this.waitTimer)
      await this.retry(this.asked.relay, this.asked.target)
    }
  }

  /** Gives the slot back, or leaves the waitlist. */
  async release(): Promise<void> {
    clearTimeout(this.waitTimer)
    this.asked = null
    const relay = this.current.relay
    await this.call(relay, 'DELETE', `/v1/links/${this.host.hostId}`).catch(() => {})
    await this.token.remove().catch(() => {})
    this.host.setState(STATE_KEY, null)
    this.set(blank(relay))
  }

  /** The relay's pool, fetched at most every ten minutes; null when it cannot be read. */
  async pool(relay: string): Promise<LinkPool | null> {
    if (this.pooled?.relay === relay && Date.now() - this.pooled.at < POOL_MS) return this.pooled.pool
    let pool: LinkPool | null = null
    try {
      const response = await this.fetcher(`${relay}/v1/pool`, { signal: AbortSignal.timeout(REQUEST_MS) })
      const body = (await response.json()) as Partial<LinkPool>
      if (response.ok && [body.capacity, body.used, body.waiting].every((n) => Number.isInteger(n) && n! >= 0))
        pool = body as LinkPool
    } catch {
      pool = null
    }
    this.pooled = { relay, at: Date.now(), pool }
    return pool
  }

  /** The cached pool, for status, without waiting on the network. */
  cachedPool(): LinkPool | null {
    return this.pooled?.pool ?? null
  }

  /**
   * A paired device connected through the link. Any number may: the month's traffic is the link's only limit. It also
   * resets the relay's idle clock, at most hourly.
   */
  arrived(deviceId: string): void {
    this.connected.add(deviceId)
    if (Date.now() - this.lastSeen > SEEN_MS && this.current.state === 'active') {
      this.lastSeen = Date.now()
      void this.call(this.current.relay, 'POST', `/v1/links/${this.host.hostId}/seen`).catch(() => {})
    }
  }

  /** A device's last connection through the link closed. */
  leave(deviceId: string): void {
    this.connected.delete(deviceId)
  }

  /** Whether a request arrived through this host's link, by the address it asked for. */
  routed(hostHeader: string | undefined): boolean {
    const hostname = this.current.hostname
    return !!hostname && !!hostHeader && hostHeader.toLowerCase().split(':')[0] === hostname
  }
}

class SignedOut extends Error {}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200)
