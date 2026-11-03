// Every computer this app talks to: the one it runs on and each one it was paired with, all connected at once.
// All computers share one shell; this module owns the connections, their health and their activity counts.
import type { RuntimeEndpoint } from '@ramu/contracts'
import type { RuntimeResult } from '@ramu/client-runtime'
import type { Computer, ComputerStatus, Computers } from '@ramu/shared/types'
import type { PushArgs } from '@ramu/shared/pushChannels'
import type { ComputerUpdate, RemoteServers, SavedServer } from './remoteServers'
import type { SshComputers } from './sshComputers'

export const LOCAL = 'local'
const COUNT_DELAY_MS = 800
const SSH_RETRY_MS = 20_000
/** Rotate a paired computer's token about monthly, well inside the host's default 90-day window. */
export const RENEW_EVERY_MS = 30 * 24 * 60 * 60_000

interface Live {
  status: ComputerStatus
  waiting?: 'network' | 'computer'
  retryAt?: number
  running: number
  needsInput: number
  stop: () => void
}
export interface ComputerDeps {
  servers: RemoteServers
  deviceName: string
  localName: () => string
  /** The local server: a unix socket path. */
  local: string
  /** Tells a host which threads to stream in full; the rest arrive in brief. Resolves once the host has it. */
  follow(target: RuntimeEndpoint, sessionIds: string[]): Promise<unknown>
  subscribe(
    target: RuntimeEndpoint,
    receive: (...args: PushArgs) => void,
    options?: { retryMode: 'events' | 'periodic' },
  ): () => void
  invoke<M extends string>(
    target: string | RuntimeEndpoint,
    method: M,
    args?: unknown[],
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<RuntimeResult<M>>
  pair(url: string, code: string, deviceName: string): Promise<{ token: string; deviceId?: string; hostId?: string }>
  /** Swaps a computer's token for a fresh one; null when it declines (no longer paired). */
  renew(url: string, token: string): Promise<{ token: string } | null>
  /** Computers reached over SSH keep a tunnel; the registry asks for it before connecting. */
  ssh: Pick<SshComputers, 'ensure' | 'connect' | 'close' | 'closeAll'>
  /** An event from a computer, for its window and its notifier. */
  deliver(id: string, ...args: PushArgs): void
  /** The list, a status or a count changed. */
  changed(): void
}

export class ComputerRegistry {
  private scope: string | null = null
  private readonly live = new Map<string, Live>()
  /** Hosts whose pairing was accepted but whose first authenticated request could not reach them yet. */
  private readonly unverified = new Set<string>()
  private readonly local: { status: ComputerStatus; running: number; needsInput: number } = {
    status: 'connected',
    running: 0,
    needsInput: 0,
  }
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly counts = new Map<string, AbortController>()
  private readonly countAgain = new Set<string>()
  private stopped = false

  constructor(private readonly deps: ComputerDeps) {}

  start() {
    for (const server of this.deps.servers.list()) this.connect(server.id)
    // Hosts reached through Ramu Link check their direct routes every minute and move back when one works.
    const direct = setInterval(() => {
      for (const [id, live] of this.live)
        if (live.status === 'connected') this.routeWork('direct', id, 60_000, (host) => this.preferDirect(host))
    }, 60_000)
    direct.unref()
    this.timers.set('direct-routes', direct)
  }

  stop() {
    this.stopped = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    for (const count of this.counts.values()) count.abort()
    this.counts.clear()
    this.countAgain.clear()
    for (const live of this.live.values()) live.stop()
    this.live.clear()
    this.deps.ssh.closeAll()
  }

  private connect(id: string) {
    this.clearCount(id)
    clearTimeout(this.timers.get(`ssh:${id}`))
    this.timers.delete(`ssh:${id}`)
    this.live.get(id)?.stop()
    const saved = this.deps.servers.get(id)
    if (saved && !saved.enabled) {
      this.live.set(id, { status: 'paused', running: 0, needsInput: 0, stop: () => {} })
      this.deps.deliver(id, 'background:connection', { connected: false, paused: true })
      return
    }
    if (saved?.ssh) {
      const live: Live = { status: 'connecting', running: 0, needsInput: 0, stop: () => {} }
      this.live.set(id, live)
      let cancelled = false,
        detach = () => {}
      live.stop = () => {
        cancelled = true
        detach()
      }
      this.deps.changed()
      void this.deps.ssh.ensure(id, saved).then(
        () => {
          if (cancelled || this.live.get(id) !== live) return
          detach = this.attach(id, live, this.deps.servers.get(id) ?? saved)
        },
        (error) => {
          if (cancelled || this.live.get(id) !== live || this.stopped) return
          live.status = 'offline'
          live.waiting = 'computer'
          live.retryAt = Date.now() + SSH_RETRY_MS
          this.deps.deliver(id, 'background:connection', {
            connected: false,
            waiting: 'computer',
            retryAt: live.retryAt,
            error: error instanceof Error ? error.message : String(error),
          })
          this.deps.changed()
          this.timers.set(
            `ssh:${id}`,
            setTimeout(() => {
              this.timers.delete(`ssh:${id}`)
              if (!cancelled && !this.stopped && this.live.get(id) === live) this.connect(id)
            }, SSH_RETRY_MS),
          )
        },
      )
      return
    }
    const endpoint = this.deps.servers.endpoint(id)
    if (!endpoint) {
      this.live.set(id, { status: 'rejected', running: 0, needsInput: 0, stop: () => {} })
      return
    }
    const live: Live = { status: 'connecting', running: 0, needsInput: 0, stop: () => {} }
    this.live.set(id, live)
    live.stop = this.attach(id, live, saved)
  }

  /** Subscribes to a computer's events; the returned function unsubscribes. */
  private attach(id: string, live: Live, saved: SavedServer | undefined): () => void {
    const endpoint = this.deps.servers.endpoint(id)
    if (!endpoint) {
      live.status = 'rejected'
      this.deps.changed()
      return () => {}
    }
    return this.deps.subscribe(
      endpoint,
      (...[channel, payload]) => {
        if (this.live.get(id) !== live) return
        if (channel === 'background:connection') {
          live.status = payload.rejected ? 'rejected' : payload.connected ? 'connected' : 'offline'
          live.waiting = payload.waiting
          live.retryAt = payload.retryAt
          if (payload.connected) {
            void this.deps.follow(endpoint, this.followed.get(id) ?? []).catch(() => {})
            this.routeWork('learn', id, 3_600_000, (host) => this.learnRoutes(host))
            this.routeWork('direct', id, 60_000, (host) => this.preferDirect(host))
            this.countSoon(id)
            void this.renewIfDue(id)
          } else if (!payload.connected) {
            if (!payload.rejected && !payload.paused) this.routeWork('try', id, 60_000, (host) => this.tryRoutes(host))
            this.clearCount(id)
            live.running = 0
            live.needsInput = 0
          }
          this.deps.changed()
        } else this.observe(id, ...([channel, payload] as PushArgs))
        this.deps.deliver(id, ...([channel, payload] as PushArgs))
      },
      { retryMode: saved?.retryMode ?? 'events' },
    )
  }

  private followed = new Map<string, string[]>()

  /** Which of a host's threads this window shows. Remembered, so a new connection starts narrowed too. */
  follow(id: string, sessionIds: string[]) {
    this.followed.set(id, sessionIds)
    const endpoint = id === LOCAL ? undefined : this.deps.servers.endpoint(id)
    return endpoint && this.status(id) === 'connected' ? this.deps.follow(endpoint, sessionIds) : undefined
  }

  /** Rotates the stored token when it is due. Any failure just retries at the next connection. */
  private async renewIfDue(id: string, now = Date.now()) {
    const renewedAt = this.deps.servers.renewedAt(id)
    if (renewedAt !== null && renewedAt <= now && now - renewedAt < RENEW_EVERY_MS) return
    const endpoint = this.deps.servers.endpoint(id)
    if (!endpoint) return
    try {
      const renewed = await this.deps.renew(endpoint.url, endpoint.token)
      if (renewed && !this.stopped && this.deps.servers.get(id)) this.deps.servers.rotate(id, renewed.token, now)
    } catch {
      // Offline: keep the current token.
    }
  }

  /** Chats starting, finishing or asking something change what the switcher shows. */
  observe(id: string, ...[channel, payload]: PushArgs) {
    if (channel === 'agent:event' && payload.event.kind === 'state') this.countSoon(id)
  }

  /** The local computer's connection, which the app itself already holds. */
  setLocalStatus(connected: boolean) {
    this.local.status = connected ? 'connected' : 'offline'
    if (connected) this.countSoon(LOCAL)
    else {
      this.clearCount(LOCAL)
      this.local.running = 0
      this.local.needsInput = 0
    }
    this.deps.changed()
  }

  private clearCount(id: string) {
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
    this.counts.get(id)?.abort()
    this.counts.delete(id)
    this.countAgain.delete(id)
  }

  private countSoon(id: string) {
    if (this.stopped || this.timers.has(id)) return
    if (this.counts.has(id)) {
      this.countAgain.add(id)
      return
    }
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id)
        if (this.stopped || !this.exists(id)) return
        const expected = id === LOCAL ? this.local : this.live.get(id)
        const status = expected?.status
        const request = new AbortController()
        this.counts.set(id, request)
        void this.deps
          .invoke(this.endpoint(id), 'agent.counts', [], { signal: request.signal, timeoutMs: 10000 })
          .then(
            (counts) => {
              const target = id === LOCAL ? this.local : this.live.get(id)
              if (
                this.stopped ||
                !target ||
                target !== expected ||
                target.status !== status ||
                (target.running === counts.running && target.needsInput === counts.needsInput)
              )
                return
              target.running = counts.running
              target.needsInput = counts.needsInput
              this.deps.changed()
            },
            () => {},
          )
          .finally(() => {
            if (this.counts.get(id) !== request) return
            this.counts.delete(id)
            if (this.countAgain.delete(id) && !this.stopped) this.countSoon(id)
          })
      }, COUNT_DELAY_MS),
    )
  }

  endpoint(id: string): string | RuntimeEndpoint {
    if (id === LOCAL) return this.deps.local
    const endpoint = this.deps.servers.endpoint(id)
    if (!endpoint) throw new Error('That host is no longer saved')
    return endpoint
  }

  status(id: string): ComputerStatus {
    if (id === LOCAL) return this.local.status
    return this.live.get(id)?.status ?? 'offline'
  }

  exists(id: string) {
    return id === LOCAL || !!this.deps.servers.get(id)
  }

  setScope(id: string | null) {
    if (id !== null && !this.exists(id)) throw new Error('That host is no longer saved')
    this.scope = id
    this.deps.changed()
  }

  list(current: string): Computers {
    const computers: Computer[] = [
      { id: LOCAL, name: this.deps.localName(), local: true, url: null, ...this.local, pairedAt: null },
      ...this.deps.servers.list().map((server): Computer => {
        const live = this.live.get(server.id)
        return {
          id: server.id,
          name: server.name,
          local: false,
          url: server.url,
          routes: this.deps.servers.routesOf(server.id),
          status: live?.status ?? 'offline',
          enabled: server.enabled,
          retryMode: server.retryMode,
          waiting: live?.waiting,
          retryAt: live?.retryAt,
          running: live?.running ?? 0,
          needsInput: live?.needsInput ?? 0,
          pairedAt: server.pairedAt,
          ...(server.ssh ? { ssh: server.ssh.target } : {}),
          ...(this.grantedUnreachable(server.id, live?.status) ? { grantedUnreachable: true } : {}),
        }
      }),
    ]
    return {
      computers,
      current,
      scope: this.scope && this.exists(this.scope) ? this.scope : null,
      deviceName: this.deps.deviceName,
    }
  }

  /** True from a pairing that could not be confirmed until the host first answers; a refusal clears it too. */
  private grantedUnreachable(id: string, status: ComputerStatus | undefined): boolean {
    if (!this.unverified.has(id)) return false
    if (status === 'connected' || status === 'rejected') {
      this.unverified.delete(id)
      return false
    }
    return true
  }

  /** Pairs with a code, proves the new token works, then connects. */
  async pair(address: string, code: string, label: string | undefined): Promise<Computer> {
    const { parseRemoteUrl } = await import('@ramu/contracts')
    const url = parseRemoteUrl(address)
    return this.savePaired(url, label, await this.deps.pair(url, code.trim(), this.deps.deviceName))
  }

  /**
   * Asks a nearby host to pair this computer: `onCode` shows the number a person at the host must see before allowing
   * it. Rejects with `PairRequestUnsupported` for a host that needs a typed code.
   */
  async pairByRequest(
    address: string,
    label: string | undefined,
    onCode: (code: string) => void,
    signal: AbortSignal,
  ): Promise<Computer> {
    const [{ parseRemoteUrl }, { requestPairing }, { randomBytes }, { hostFetch }] = await Promise.all([
      import('@ramu/contracts'),
      import('@ramu/shared/pairRequest'),
      import('node:crypto'),
      import('@ramu/client-runtime'),
    ])
    const url = parseRemoteUrl(address)
    const result = await requestPairing({
      post: async (path, body, aborted) => {
        const response = await hostFetch(new URL(path, url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: aborted,
        })
        const text = await response.text()
        let parsed: unknown = null
        try {
          parsed = text ? JSON.parse(text) : null
        } catch {}
        return { status: response.status, body: parsed }
      },
      name: this.deps.deviceName,
      random: (bytes) => new Uint8Array(randomBytes(bytes)),
      onCode,
      signal,
    })
    return this.savePaired(url, label, result)
  }

  private async savePaired(
    url: string,
    label: string | undefined,
    { token, deviceId, hostId, linkKey }: { token: string; deviceId?: string; hostId?: string; linkKey?: string },
  ): Promise<Computer> {
    // The code is spent once the token exists. If the first request fails, keep the credential and let the normal
    // connection retry reach the host, rather than discarding a valid grant the person cannot get again.
    const status = (await this.deps
      .invoke({ kind: 'http', url, token }, 'background.status')
      .catch((error: unknown) => {
        // A refused token is a real failure; an unreachable or slow host is not.
        if (/rejected|revoked|unauthori[sz]ed/i.test(error instanceof Error ? error.message : String(error)))
          throw error
        return undefined
      })) as { hostname?: string } | undefined
    // Like Tailscale and NetBird: unless you name it, a computer is called what it calls itself.
    const saved = this.deps.servers.add(url, label?.trim() || status?.hostname, token, Date.now(), undefined, {
      deviceId,
      hostId,
      ...(linkKey ? { linkKey } : {}),
    })
    // Access was granted but never confirmed by a normal request: say so until the host answers, instead of
    // showing a connected host or asking for the spent code again.
    if (!status) this.unverified.add(saved.id)
    // Pairing an address again replaces its entry under a new id; pairing a known host again keeps its id, so its old
    // connection (to the previous address and token) is stopped here and `connect` below starts one with the new ones.
    const ids = new Set(this.deps.servers.list().map((server) => server.id))
    for (const [id, live] of this.live)
      if (!ids.has(id) || id === saved.id) {
        this.clearCount(id)
        live.stop()
        this.live.delete(id)
        this.unverified.delete(id)
      }
    this.connect(saved.id)
    this.deps.changed()
    return this.list(LOCAL).computers.find((computer) => computer.id === saved.id)!
  }

  /** Adds a computer by SSH: provisions it, tunnels to it and pairs through the tunnel. */
  async pairSsh(target: string, label: string | undefined): Promise<Computer> {
    const opened = await this.deps.ssh.connect(target, this.deps.deviceName, this.deps.pair)
    let status: { hostname?: string } | undefined
    try {
      status = (await this.deps.invoke({ kind: 'http', url: opened.url, token: opened.token }, 'background.status')) as
        { hostname?: string } | undefined
    } catch (error) {
      opened.discard()
      throw error
    }
    const saved = this.deps.servers.add(
      opened.url,
      label?.trim() || status?.hostname,
      opened.token,
      Date.now(),
      opened.route,
    )
    opened.release(saved.id)
    const ids = new Set(this.deps.servers.list().map((server) => server.id))
    for (const [id, live] of this.live)
      if (!ids.has(id)) {
        this.clearCount(id)
        live.stop()
        this.live.delete(id)
        this.deps.ssh.close(id)
      }
    this.connect(saved.id)
    this.deps.changed()
    return this.list(LOCAL).computers.find((computer) => computer.id === saved.id)!
  }

  /** The saved computer whose pairing was bound to this host id, to mark a nearby result as already paired. */
  byHostId(hostId: string): string | null {
    return this.deps.servers.byHostId(hostId)?.id ?? null
  }

  /**
   * Moves a saved computer to a new address, but only after that address proves it is the host this device paired
   * with. Nothing is sent to it except this device's id and a fresh challenge; a different or silent host leaves the
   * working address alone and the person pairs again deliberately.
   */
  async reviewAddress(
    id: string,
    address: string,
  ): Promise<'moved' | 'unchanged' | 'mismatch' | 'unsupported' | 'unreachable' | 'insecure'> {
    if (id === LOCAL) throw new Error('This host has no address to review')
    const saved = this.deps.servers.get(id)
    const endpoint = this.deps.servers.endpoint(id)
    const deviceId = this.deps.servers.deviceIdOf(id)
    if (!saved || !endpoint || saved.ssh) throw new Error('That host is no longer saved')
    const { parseRemoteUrl } = await import('@ramu/contracts')
    const url = parseRemoteUrl(address)
    if (url === saved.url) return 'unchanged'
    if (!saved.hostId || !deviceId) return 'unsupported'
    // A credential issued over HTTPS never moves to plain HTTP on its own: the person pairs that address explicitly.
    if (saved.url.startsWith('https:') && url.startsWith('http:')) return 'insecure'
    const result = await this.verify(url, deviceId, endpoint.token, saved.hostId)
    if (result.state !== 'verified') return result.state
    this.deps.servers.setRoutes(id, result.routes)
    this.deps.servers.setUrl(id, url)
    this.connect(id)
    this.deps.changed()
    return 'moved'
  }

  private async verify(url: string, deviceId: string, token: string, hostId: string) {
    const { verifyHost } = await import('@ramu/shared/hostProof')
    const { randomBytes } = await import('node:crypto')
    const { hostFetch } = await import('@ramu/client-runtime')
    return verifyHost({
      fetch: (target, init) => hostFetch(target, { ...init, redirect: 'error', signal: AbortSignal.timeout(8000) }),
      baseUrl: url,
      deviceId,
      token,
      expectedHostId: hostId,
      challenge: randomBytes(16).toString('hex'),
    })
  }

  /** While the host answers, keep the other addresses it names. Only a proven answer is believed. */
  private async learnRoutes(id: string) {
    const saved = this.deps.servers.get(id)
    const endpoint = this.deps.servers.endpoint(id)
    const deviceId = this.deps.servers.deviceIdOf(id)
    if (!saved?.hostId || !endpoint || !deviceId || saved.ssh) return
    const result = await this.verify(saved.url, deviceId, endpoint.token, saved.hostId)
    if (result.state !== 'verified' || !this.deps.servers.get(id)) return
    this.deps.servers.setRoutes(id, result.routes)
    if (result.linkKey) this.deps.servers.setLinkKey(id, result.linkKey)
  }

  /** On Link, a direct route is faster and needs no relay: move back to one as soon as it proves itself. */
  private async preferDirect(id: string) {
    const saved = this.deps.servers.get(id)
    if (!saved || !saved.url.endsWith('.link.invalid')) return
    for (const route of this.deps.servers.routesOf(id)) {
      if (this.stopped || route.endsWith('.link.invalid')) continue
      if ((await this.reviewAddress(id, route).catch(() => 'unreachable')) === 'moved') return
    }
  }

  /** When the saved address stops answering, try the learned ones; each must prove it is this host before it is used. */
  private async tryRoutes(id: string) {
    for (const route of this.deps.servers.routesOf(id)) {
      if (this.stopped || !this.deps.servers.get(id)) return
      if ((await this.reviewAddress(id, route).catch(() => 'unreachable')) === 'moved') return
    }
  }

  private routeTimes = new Map<string, number>()
  /** Runs `work` for a host at most once per `every` ms. */
  private routeWork(kind: 'learn' | 'try' | 'direct', id: string, every: number, work: (id: string) => Promise<void>) {
    const now = Date.now()
    const key = `${kind}:${id}`
    if (now - (this.routeTimes.get(key) ?? -Infinity) < every) return
    this.routeTimes.set(key, now)
    void work(id).catch(() => {})
  }

  forget(id: string) {
    if (id === LOCAL) throw new Error('This host cannot be removed')
    this.deps.ssh.close(id)
    clearTimeout(this.timers.get(`ssh:${id}`))
    this.timers.delete(`ssh:${id}`)
    this.clearCount(id)
    this.live.get(id)?.stop()
    this.live.delete(id)
    this.deps.servers.forget(id)
    this.unverified.delete(id)
    this.deps.changed()
  }

  retry(id: string) {
    if (id !== LOCAL && this.exists(id)) {
      this.connect(id)
      this.deps.changed()
    }
  }

  update(id: string, changes: ComputerUpdate) {
    if (id === LOCAL) throw new Error('Manage this host on its own settings screen')
    const before = this.deps.servers.get(id)
    const saved = this.deps.servers.update(id, changes)
    if (saved.enabled !== before?.enabled || saved.retryMode !== before?.retryMode) this.connect(id)
    this.deps.changed()
  }
}
