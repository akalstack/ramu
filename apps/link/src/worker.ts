// ramu-link.akalstack.com: the Worker in front of the one SlotPool Durable Object. It rate-limits link requests per session,
// caches the public pool for a minute, and runs the five-minute sweep. Hosts' own traffic never passes through here: it
// goes through each host's Cloudflare Tunnel.
import { cloudflare } from './cloudflare'
import { createRelay } from './relay'
import { sqlStore } from './sqlStore'
import { bearerOf } from './validate'

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/v1/')) return new Response('Ramu Link', { status: 404 })
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
