// Every computer this app talks to: the one it runs on and each one it was paired with, all connected at once.
// Each computer keeps its own window; this module owns the connections, their health and their activity counts.
import type { RuntimeEndpoint } from '@ramu/contracts'
import type { Computer, ComputerStatus, Computers } from '@ramu/shared/types'
import type { ComputerUpdate, RemoteServers } from './remoteServers'

export const LOCAL = 'local'
const COUNT_DELAY_MS = 800

interface Live { status: ComputerStatus; waiting?: 'network' | 'computer'; retryAt?: number; running: number; needsInput: number; stop: () => void }
export interface ComputerDeps {
  servers: RemoteServers
  deviceName: string
  localName: () => string
  /** The local server: a unix socket path. */
  local: string
  subscribe(target: RuntimeEndpoint, receive: (channel: string, payload: any) => void, options?: { retryMode: 'events' | 'periodic' }): () => void
  invoke(target: string | RuntimeEndpoint, method: string, args?: unknown[], options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<any>
  pair(url: string, code: string, deviceName: string): Promise<{ token: string }>
  /** An event from a computer, for its window and its notifier. */
  deliver(id: string, channel: string, payload: any): void
  /** The list, a status or a count changed. */
  changed(): void
}

export class ComputerRegistry {
  private readonly live = new Map<string, Live>()
  private readonly local: { status: ComputerStatus; running: number; needsInput: number } = { status: 'connected', running: 0, needsInput: 0 }
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly counts = new Map<string, AbortController>()
  private readonly countAgain = new Set<string>()
  private stopped = false

  constructor(private readonly deps: ComputerDeps) {}

  start() { for (const server of this.deps.servers.list()) this.connect(server.id) }

  stop() {
    this.stopped = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    for (const count of this.counts.values()) count.abort()
    this.counts.clear(); this.countAgain.clear()
    for (const live of this.live.values()) live.stop()
    this.live.clear()
  }

  private connect(id: string) {
    this.clearCount(id)
    this.live.get(id)?.stop()
    const saved = this.deps.servers.get(id)
    if (saved && !saved.enabled) {
      this.live.set(id, { status: 'paused', running: 0, needsInput: 0, stop: () => {} })
      this.deps.deliver(id, 'background:connection', { connected: false, paused: true })
      return
    }
    const endpoint = this.deps.servers.endpoint(id)
    if (!endpoint) { this.live.set(id, { status: 'rejected', running: 0, needsInput: 0, stop: () => {} }); return }
    const live: Live = { status: 'connecting', running: 0, needsInput: 0, stop: () => {} }
    this.live.set(id, live)
    live.stop = this.deps.subscribe(endpoint, (channel, payload) => {
      if (this.live.get(id) !== live) return
      if (channel === 'background:connection') {
        live.status = payload.rejected ? 'rejected' : payload.connected ? 'connected' : 'offline'
        live.waiting = payload.waiting
        live.retryAt = payload.retryAt
        if (payload.connected) this.countSoon(id)
        else if (!payload.connected) { this.clearCount(id); live.running = 0; live.needsInput = 0 }
        this.deps.changed()
      } else this.observe(id, channel, payload)
      this.deps.deliver(id, channel, payload)
    }, { retryMode: saved?.retryMode ?? 'events' })
  }

  /** Chats starting, finishing or asking something change what the switcher shows. */
  observe(id: string, channel: string, payload: any) {
    if (channel === 'agent:event' && payload?.event?.kind === 'state') this.countSoon(id)
  }

  /** The local computer's connection, which the app itself already holds. */
  setLocalStatus(connected: boolean) {
    this.local.status = connected ? 'connected' : 'offline'
    if (connected) this.countSoon(LOCAL)
    else { this.clearCount(LOCAL); this.local.running = 0; this.local.needsInput = 0 }
    this.deps.changed()
  }

  private clearCount(id: string) {
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
    this.counts.get(id)?.abort(); this.counts.delete(id); this.countAgain.delete(id)
  }

  private countSoon(id: string) {
    if (this.stopped || this.timers.has(id)) return
    if (this.counts.has(id)) { this.countAgain.add(id); return }
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id)
      if (this.stopped || !this.exists(id)) return
      const expected = id === LOCAL ? this.local : this.live.get(id)
      const status = expected?.status
      const request = new AbortController()
      this.counts.set(id, request)
      void this.deps.invoke(this.endpoint(id), 'agent.counts', [], { signal: request.signal, timeoutMs: 10000 }).then((counts: { running: number; needsInput: number }) => {
        const target = id === LOCAL ? this.local : this.live.get(id)
        if (this.stopped || !target || target !== expected || target.status !== status || (target.running === counts.running && target.needsInput === counts.needsInput)) return
        target.running = counts.running; target.needsInput = counts.needsInput
        this.deps.changed()
      }, () => {}).finally(() => {
        if (this.counts.get(id) !== request) return
        this.counts.delete(id)
        if (this.countAgain.delete(id) && !this.stopped) this.countSoon(id)
      })
    }, COUNT_DELAY_MS))
  }

  endpoint(id: string): string | RuntimeEndpoint {
    if (id === LOCAL) return this.deps.local
    const endpoint = this.deps.servers.endpoint(id)
    if (!endpoint) throw new Error('That computer is no longer saved')
    return endpoint
  }

  status(id: string): ComputerStatus {
    if (id === LOCAL) return this.local.status
    return this.live.get(id)?.status ?? 'offline'
  }

  exists(id: string) { return id === LOCAL || !!this.deps.servers.get(id) }

  list(current: string): Computers {
    const computers: Computer[] = [
      { id: LOCAL, name: this.deps.localName(), local: true, url: null, ...this.local, pairedAt: null },
      ...this.deps.servers.list().map((server): Computer => {
        const live = this.live.get(server.id)
        return { id: server.id, name: server.name, local: false, url: server.url, status: live?.status ?? 'offline', enabled: server.enabled, retryMode: server.retryMode, waiting: live?.waiting, retryAt: live?.retryAt, running: live?.running ?? 0, needsInput: live?.needsInput ?? 0, pairedAt: server.pairedAt }
      }),
    ]
    return { computers, current, deviceName: this.deps.deviceName }
  }

  /** Pairs with a code, proves the new token works, then connects. */
  async pair(address: string, code: string, label: string | undefined): Promise<Computer> {
    const { parseRemoteUrl } = await import('@ramu/contracts')
    const url = parseRemoteUrl(address)
    const { token } = await this.deps.pair(url, code.trim(), this.deps.deviceName)
    await this.deps.invoke({ kind: 'http', url, token }, 'background.status')
    const saved = this.deps.servers.add(url, label, token)
    // Pairing an address again replaces its entry under a new id.
    const ids = new Set(this.deps.servers.list().map((server) => server.id))
    for (const [id, live] of this.live) if (!ids.has(id)) { this.clearCount(id); live.stop(); this.live.delete(id) }
    this.connect(saved.id)
    this.deps.changed()
    return this.list(LOCAL).computers.find((computer) => computer.id === saved.id)!
  }

  forget(id: string) {
    if (id === LOCAL) throw new Error('This computer cannot be removed')
    this.clearCount(id)
    this.live.get(id)?.stop(); this.live.delete(id)
    this.deps.servers.forget(id)
    this.deps.changed()
  }

  retry(id: string) {
    if (id !== LOCAL && this.exists(id)) { this.connect(id); this.deps.changed() }
  }

  update(id: string, changes: ComputerUpdate) {
    if (id === LOCAL) throw new Error('Manage this computer on its own settings screen')
    const before = this.deps.servers.get(id)
    const saved = this.deps.servers.update(id, changes)
    if (saved.enabled !== before?.enabled || saved.retryMode !== before?.retryMode) this.connect(id)
    this.deps.changed()
  }
}
