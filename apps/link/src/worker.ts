// ramu-link.akalstack.com: the Worker in front of the one SlotPool Durable Object. It rate-limits link requests per session,
// caches the public pool for a minute, and runs the five-minute sweep. Hosts' own traffic never passes through here: it
// goes through each host's Cloudflare Tunnel. It also carries live pull request events from the Ramu GitHub App to the
// hosts that may read each repository (PullRequestEvents).
import { cloudflare } from './cloudflare'
import { createRelay } from './relay'
import { sqlStore } from './sqlStore'
import { bearerOf, readJson } from './validate'
import { apnsTokens, liveActivityPush, sendLiveActivity } from './liveActivities'
import { LIVE_ACTIVITY_PATH } from '@ramu/shared/ramuLink'
import { createPullRequestEvents, type Attachment, type EventSocket } from './pullRequestEvents'
import { EVENTS_PING, EVENTS_PONG, EVENTS_SOCKET_PATH, GITHUB_APP_EVENTS_PATH } from '@ramu/shared/pullRequestEvents'

export interface Env {
  POOL: DurableObjectNamespace
  ALLOCATIONS: RateLimit
  LOOKUPS: RateLimit
  ZONE: string
  CAPACITY: string
  ACCOUNT_URL: string
  CF_API_TOKEN: string
  CF_ACCOUNT_ID: string
  CF_ZONE_ID: string
  EVENTS: DurableObjectNamespace
  /** The Ramu GitHub App's webhook secret. */
  GITHUB_APP_WEBHOOK_SECRET: string
  /** Live Activity pushes per account. */
  PUSHES: RateLimit
  /** Apple's push key (.p8 text), its key id and team id; without them Link answers 503 and hosts keep local updates. */
  APNS_KEY?: string
  APNS_KEY_ID?: string
  APNS_TEAM_ID?: string
  APNS_BUNDLE_ID: string
}

/** The path the Worker uses to start a sweep; never forwarded from a public request. */
const SWEEP_PATH = '/internal/sweep'

const pool = (env: Env) => env.POOL.get(env.POOL.idFromName('pool'))

async function accountUser(env: Env, token: string): Promise<string | null> {
  const response = await fetch(`${env.ACCOUNT_URL.replace(/\/$/, '')}/api/me`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (response.status === 401 || response.status === 403) return null
  if (!response.ok) throw new Error(`The account service answered ${response.status}`)
  const user = (await response.json()) as { id?: unknown }
  return typeof user.id === 'string' && user.id.length > 0 && user.id.length <= 200 ? user.id : null
}

// A host sends a push on each change of its work; asking the account service each time would be slow, so who a session
// belongs to is kept for a few minutes in this isolate.
const sessions = new Map<string, { user: string; at: number }>()
async function sessionUser(env: Env, bearer: string): Promise<string | null> {
  const kept = sessions.get(bearer)
  if (kept && Date.now() - kept.at < 5 * 60_000) return kept.user
  const user = await accountUser(env, bearer)
  if (user) sessions.set(bearer, { user, at: Date.now() })
  if (sessions.size > 1000) sessions.delete(sessions.keys().next().value!)
  return user
}

const apnsJwt = apnsTokens()

/** A signed-in host's Live Activity push for one of its paired iPhones (see liveActivities.ts). */
async function liveActivity(request: Request, env: Env): Promise<Response> {
  if (!env.APNS_KEY || !env.APNS_KEY_ID || !env.APNS_TEAM_ID) return Response.json({ status: 503 }, { status: 503 })
  const bearer = bearerOf(request.headers.get('Authorization'))
  const user = bearer ? await sessionUser(env, bearer) : null
  if (!user) return new Response(null, { status: 401 })
  const { success } = await env.PUSHES.limit({ key: user })
  if (!success) return Response.json({ status: 429 }, { status: 429 })
  const push = liveActivityPush.safeParse(await readJson(request))
  if (!push.success) return new Response(null, { status: 400 })
  const key = { key: env.APNS_KEY, keyId: env.APNS_KEY_ID, teamId: env.APNS_TEAM_ID, bundleId: env.APNS_BUNDLE_ID }
  const now = Date.now()
  return Response.json(await sendLiveActivity(push.data, key, await apnsJwt(key, now), now))
}

function randomSlug(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export class SlotPool {
  private readonly relay: ReturnType<typeof createRelay>

  constructor(ctx: DurableObjectState, env: Env) {
    this.relay = createRelay({
      store: sqlStore(ctx.storage.sql),
      cf: cloudflare({ token: env.CF_API_TOKEN, accountId: env.CF_ACCOUNT_ID, zoneId: env.CF_ZONE_ID, fetch }),
      capacity: Number(env.CAPACITY) || 950,
      zone: env.ZONE,
      account: (token) => accountUser(env, token),
      now: Date.now,
      slug: randomSlug,
    })
  }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === SWEEP_PATH) return Response.json(await this.relay.sweep())
    return this.relay.handle(request)
  }
}

/** Whether a GitHub token can read a repository: GitHub answers it with the repository, under the same name. */
async function canRead(repo: string, token: string): Promise<boolean> {
  const response = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ramu-link',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) return false
  const found = (await response.json()) as { full_name?: string }
  return found.full_name?.toLowerCase() === repo
}

/**
 * Every host's event socket and the GitHub App's deliveries meet in this one object. Sockets hibernate between events,
 * and pings are answered without waking it; which repositories have the App is kept in its own SQLite.
 */
export class PullRequestEvents {
  private readonly events: ReturnType<typeof createPullRequestEvents>

  constructor(
    private readonly ctx: DurableObjectState,
    env: Env,
  ) {
    const sql = ctx.storage.sql
    sql.exec('CREATE TABLE IF NOT EXISTS installed (repo TEXT PRIMARY KEY, installation INTEGER NOT NULL)')
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(EVENTS_PING, EVENTS_PONG))
    this.events = createPullRequestEvents({
      sockets: () => ctx.getWebSockets().map(wrap),
      installed: {
        has: (repo) => sql.exec('SELECT 1 FROM installed WHERE repo = ?', repo).toArray().length > 0,
        add: (installation, repos) => {
          for (const repo of repos)
            sql.exec(
              'INSERT INTO installed (repo, installation) VALUES (?, ?) ON CONFLICT(repo) DO UPDATE SET installation = excluded.installation',
              repo,
              installation,
            )
        },
        remove: (repos) => {
          for (const repo of repos) sql.exec('DELETE FROM installed WHERE repo = ?', repo)
        },
        dropInstallation: (installation) => {
          const repos = sql
            .exec<{ repo: string }>('SELECT repo FROM installed WHERE installation = ?', installation)
            .toArray()
            .map((row) => row.repo)
          sql.exec('DELETE FROM installed WHERE installation = ?', installation)
          return repos
        },
      },
      account: (bearer) => accountUser(env, bearer),
      canRead,
      secret: env.GITHUB_APP_WEBHOOK_SECRET ?? '',
    })
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === EVENTS_SOCKET_PATH) {
      const pair = new WebSocketPair()
      this.ctx.acceptWebSocket(pair[1])
      return new Response(null, { status: 101, webSocket: pair[0] })
    }
    if (path === GITHUB_APP_EVENTS_PATH) {
      const status = await this.events.github({
        event: request.headers.get('X-GitHub-Event'),
        signature: request.headers.get('X-Hub-Signature-256'),
        body: await request.arrayBuffer(),
      })
      return new Response(null, { status })
    }
    return new Response(null, { status: 404 })
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === 'string') await this.events.message(wrap(socket), message)
  }

  webSocketClose(socket: WebSocket, code: number): void {
    // A socket may only be closed with 1000 or an application code; the codes that describe a lost connection
    // (1005, 1006, 1015) are reported, never sent.
    socket.close(code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000, 'closed')
  }
}

const wrap = (socket: WebSocket): EventSocket => ({
  send: (message) => socket.send(message),
  close: (code, reason) => socket.close(code, reason),
  attachment: () => (socket.deserializeAttachment() as Attachment | null) ?? null,
  attach: (value) => socket.serializeAttachment(value),
})

const events = (env: Env) => env.EVENTS.get(env.EVENTS.idFromName('events'))
/** GitHub's deliveries are at most 25 MB; anything near that is not one this relay needs to read. */
const MAX_GITHUB_BODY = 5 * 1024 * 1024

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === GITHUB_APP_EVENTS_PATH && request.method === 'POST') {
      if (Number(request.headers.get('Content-Length') ?? 0) > MAX_GITHUB_BODY)
        return new Response(null, { status: 413 })
      return events(env).fetch(request)
    }
    if (url.pathname === EVENTS_SOCKET_PATH) {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response(null, { status: 426 })
      // A socket is signed in by its first message; connecting at all is limited per address.
      const { success } = await env.LOOKUPS.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'anonymous' })
      if (!success) return new Response(null, { status: 429 })
      return events(env).fetch(request)
    }
    if (!url.pathname.startsWith('/v1/')) return new Response('Ramu Link', { status: 404 })
    if (url.pathname === LIVE_ACTIVITY_PATH && request.method === 'POST') return liveActivity(request, env)
    if (url.pathname === '/v1/pool' && request.method === 'GET') {
      const cached = await caches.default.match(request)
      if (cached) return cached
      const response = await pool(env).fetch(request)
      if (response.ok) await caches.default.put(request, response.clone())
      return response
    }
    // Every link call checks its session with the account service, so one address cannot flood it with made-up ones.
    if (url.pathname === '/v1/links' || url.pathname.startsWith('/v1/links/')) {
      const { success } = await env.LOOKUPS.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'anonymous' })
      if (!success) return Response.json({ state: 'unavailable', reason: 'rate-limited' }, { status: 429 })
    }
    if (url.pathname === '/v1/links' && request.method === 'POST') {
      const key = bearerOf(request.headers.get('Authorization'))?.slice(-32) ?? request.headers.get('CF-Connecting-IP')
      const { success } = await env.ALLOCATIONS.limit({ key: key ?? 'anonymous' })
      if (!success) return Response.json({ state: 'unavailable', reason: 'rate-limited' }, { status: 429 })
    }
    return pool(env).fetch(request)
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(pool(env).fetch(new Request(`https://link.internal${SWEEP_PATH}`, { method: 'POST' })))
  },
}
