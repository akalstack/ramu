// The host's side of live pull request events from the Ramu GitHub App: one socket to Ramu Link, signed in with the
// Ramu account, watching the GitHub repositories of the projects. It needs no public address and no admin rights on a
// repository, only the App installed there. It reconnects by itself, and after any gap it has everything read again
// once, since events sent while it was away are not replayed.
import {
  EVENTS_PING,
  EVENTS_PONG,
  EVENTS_SOCKET_PATH,
  EVENT_LIMITS,
  type HostMessage,
  type RelayMessage,
  type RepoEventState,
} from '@ramu/shared/pullRequestEvents'

export type AppEventsState = 'off' | 'connecting' | 'connected' | 'signed-out' | 'unavailable'

export interface AppEventsHost {
  /** The Ramu Link relay, such as https://ramu-link.akalstack.com. */
  relay(): string
  /** The Ramu account session, or null when this host is signed out. */
  bearer(): Promise<string | null>
  /** The repositories to watch, grouped by the GitHub token that reads them. */
  watched(): Promise<{ token: string; repos: string[] }[]>
  /** The connection or a repository's state changed. */
  stateChanged(): void
  /** A watched repository changed on GitHub. */
  changed(repo: string): void
  /** Connected again after a gap: anything may have changed meanwhile. */
  resync(): void
  socket?: (url: string) => WebSocket
  now?: () => number
}

const RETRY_MIN_MS = 1_000
const RETRY_MAX_MS = 60_000
/** Signed out: asked again this often, as a sign-in also restarts it. */
const SIGNED_OUT_RETRY_MS = 5 * 60_000

export class GithubAppEvents {
  private socket: WebSocket | null = null
  private current: AppEventsState = 'off'
  private readonly repos = new Map<string, RepoEventState>()
  private retryMs = RETRY_MIN_MS
  private retry?: ReturnType<typeof setTimeout>
  private ping?: ReturnType<typeof setInterval>
  private heard = 0
  private wanted = false
  /** The last watch sent on this connection, so asking again with nothing new costs the relay no GitHub reads. */
  private sent: string | null = null

  constructor(private readonly host: AppEventsHost) {}

  state(): AppEventsState {
    return this.current
  }
  /** What the relay said about a watched repository, by `owner/repo`. */
  repoState(repo: string): RepoEventState | undefined {
    return this.repos.get(repo.toLowerCase())
  }

  private set(state: AppEventsState) {
    if (state === this.current) return
    this.current = state
    this.host.stateChanged()
  }

  /** Connects, or watches the current repositories again on a connection already open. */
  start(): void {
    this.wanted = true
    if (this.socket?.readyState === 1 && this.current === 'connected') return void this.watch()
    if (!this.socket) this.connect()
  }

  stop(): void {
    this.wanted = false
    clearTimeout(this.retry)
    this.close()
    this.repos.clear()
    this.set('off')
  }

  private close() {
    clearInterval(this.ping)
    const socket = this.socket
    this.socket = null
    this.sent = null
    // What the relay said held only while it was connected; a closed socket says nothing about any repository.
    this.repos.clear()
    if (socket && socket.readyState <= 1) socket.close(1000, 'done')
  }

  private later(ms: number) {
    clearTimeout(this.retry)
    if (!this.wanted) return
    this.retry = setTimeout(() => this.connect(), ms)
    this.retry.unref?.()
  }

  private connect() {
    if (!this.wanted || this.socket) return
    this.set('connecting')
    const url = `${this.host.relay().replace(/^http/, 'ws').replace(/\/$/, '')}${EVENTS_SOCKET_PATH}`
    let socket: WebSocket
    try {
      socket = this.host.socket ? this.host.socket(url) : new WebSocket(url)
    } catch {
      this.set('unavailable')
      return this.backoff()
    }
    this.socket = socket
    const now = this.host.now ?? Date.now
    socket.addEventListener('open', () => {
      this.heard = now()
      void this.host.bearer().then((bearer) => {
        if (this.socket !== socket) return
        if (!bearer) {
          this.set('signed-out')
          this.close()
          return this.later(SIGNED_OUT_RETRY_MS)
        }
        this.send({ t: 'hello', bearer })
      })
      this.ping = setInterval(() => {
        if (now() - this.heard > EVENT_LIMITS.silentMs) {
          // A socket that stopped answering is replaced; events go nowhere meanwhile.
          this.close()
          this.set('unavailable')
          return this.backoff()
        }
        if (socket.readyState === 1) socket.send(EVENTS_PING)
      }, EVENT_LIMITS.pingMs)
      this.ping.unref?.()
    })
    socket.addEventListener('message', (event) => {
      this.heard = now()
      if (typeof event.data === 'string') this.receive(event.data)
    })
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return
      this.close()
      if (this.current !== 'signed-out') this.set('unavailable')
      if (this.current === 'unavailable') this.backoff()
    })
    socket.addEventListener('error', () => {})
  }

  private backoff() {
    const wait = this.retryMs
    this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2)
    // Spread out, so hosts that lost the relay together do not all come back in the same second.
    this.later(wait / 2 + Math.random() * (wait / 2))
  }

  private send(message: HostMessage) {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(message))
  }

  private async watch() {
    const groups = await this.host.watched().catch(() => [])
    // The relay refuses a watch over its limits outright, so the host keeps to them and the rest fall back to webhooks.
    let room: number = EVENT_LIMITS.reposPerConnection
    const kept = groups.slice(0, EVENT_LIMITS.tokensPerWatch).flatMap((group) => {
      const repos = group.repos.slice(0, Math.max(0, room))
      room -= repos.length
      return repos.length ? [{ token: group.token, repos }] : []
    })
    const message = JSON.stringify({ t: 'watch', groups: kept } satisfies HostMessage)
    if (message === this.sent || this.socket?.readyState !== 1) return
    this.sent = message
    this.socket.send(message)
  }

  /** Takes the relay's word for these repositories, and says so only when something changed. */
  private learn(states: [string, RepoEventState][], replace: boolean) {
    const before = JSON.stringify([...this.repos].sort())
    if (replace) this.repos.clear()
    for (const [repo, state] of states) this.repos.set(repo, state)
    if (JSON.stringify([...this.repos].sort()) !== before) this.host.stateChanged()
  }

  private receive(text: string) {
    if (text === EVENTS_PONG) return
    let message: RelayMessage
    try {
      message = JSON.parse(text) as RelayMessage
    } catch {
      return
    }
    if (message.t === 'ready') {
      this.retryMs = RETRY_MIN_MS
      this.set('connected')
      void this.watch()
      this.host.resync()
    } else if (message.t === 'watching') {
      this.learn(
        message.repos.map(({ repo, state }) => [repo, state]),
        true,
      )
    } else if (message.t === 'installed') {
      this.learn(
        message.repos.map((repo) => [repo, message.installed ? 'live' : 'not-installed']),
        false,
      )
    } else if (message.t === 'event') this.host.changed(message.repo)
    else if (message.t === 'error' && message.reason === 'signed-out') {
      this.set('signed-out')
      this.close()
      this.later(SIGNED_OUT_RETRY_MS)
    } else if (message.t === 'error') {
      // A refused watch leaves the repositories to their webhooks; the next change of projects asks again.
      console.error('Ramu Link refused the pull request watch:', message.reason)
      this.sent = null
    }
  }
}
