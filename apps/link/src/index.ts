// Ramu Link on Cloudflare Workers: Better Auth for Google and GitHub sign-in (device-code flow for every Ramu client),
// a registry of the hosts each account linked, and the relay that joins a device's stream to its host.
import { LINK_CLOSE, LINK_PROTOCOL, credentialFromProtocols, isHostId } from '@ramu/shared/link/protocol'
import { createAuth, providers, type Auth, type Env } from './auth'
import { devicePage, language } from './page'
import { hostLimit, registerHost, removeHost, type HostRow } from './hosts'

export { HostRelay } from './relay'

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
const failure = (error: string, status: number) => json({ error }, status)

/** A WebSocket refused with a close code the client can read, instead of an HTTP status it often cannot. */
function refuse(code: number, reason: string): Response {
  const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
  server.accept()
  server.close(code, reason)
  return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': LINK_PROTOCOL } })
}

async function userOf(auth: Auth, headers: Headers): Promise<{ id: string; name: string; email: string } | null> {
  const session = await auth.api.getSession({ headers }).catch(() => null)
  return session?.user ? { id: session.user.id, name: session.user.name, email: session.user.email } : null
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
/** Equal-length hex compared without an early exit. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const relay = (env: Env, hostId: string, query: Record<string, string>, request: Request) => {
  const stub = env.RELAY.get(env.RELAY.idFromName(hostId))
  const url = new URL('https://relay/')
  for (const [key, value] of Object.entries({ ...query, host: hostId })) url.searchParams.set(key, value)
  return stub.fetch(new Request(url, request))
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const auth = createAuth(env)

    if (path.startsWith('/api/auth/')) return auth.handler(request)

    if (path === '/device' && request.method === 'GET') {
      const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
      return new Response(
        devicePage(language(request.headers.get('accept-language')), Object.keys(providers(env)), nonce),
        {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
            'x-frame-options': 'DENY',
          },
        },
      )
    }

    if (path === '/health') return json({ ok: true })

    // A host keeps one socket here, authenticated by the secret it got when it was linked.
    if (path === '/v1/relay/host') {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return failure('Expected a WebSocket', 426)
      const secret = credentialFromProtocols(request.headers.get('sec-websocket-protocol'), 'host')
      const hostId = secret?.split('.')[0] ?? ''
      if (!secret || !isHostId(hostId)) return refuse(LINK_CLOSE.unauthorized, 'Unknown host')
      const row = await env.DB.prepare('SELECT secretHash FROM host WHERE id = ?').bind(hostId).first<HostRow>()
      if (!row || !sameHex(row.secretHash, await sha256Hex(secret)))
        return refuse(LINK_CLOSE.unauthorized, 'Unknown host')
      return relay(env, hostId, { role: 'host' }, request)
    }

    // A device opens one socket per stream, signed in to the account that linked the host.
    const connect = /^\/v1\/relay\/connect\/([0-9a-f]{32})$/.exec(path)
    if (connect) {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return failure('Expected a WebSocket', 426)
      const token = credentialFromProtocols(request.headers.get('sec-websocket-protocol'), 'bearer')
      const user = token ? await userOf(auth, new Headers({ authorization: `Bearer ${token}` })) : null
      if (!user) return refuse(LINK_CLOSE.unauthorized, 'Sign in again')
      const hostId = connect[1]!
      const owned = await env.DB.prepare('SELECT id FROM host WHERE id = ? AND userId = ?')
        .bind(hostId, user.id)
        .first()
      // The same answer for a host that does not exist and one owned by another account.
      if (!owned) return refuse(LINK_CLOSE.hostOffline, 'Host offline')
      return relay(env, hostId, { role: 'device', account: user.id }, request)
    }

    if (!path.startsWith('/v1/')) return failure('Not found', 404)
    const user = await userOf(auth, request.headers)
    if (!user) return failure('Sign in to Ramu Link first', 401)

    if (path === '/v1/me' && request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT id FROM host WHERE userId = ?').bind(user.id).all()
      return json({ user: { name: user.name, email: user.email }, hosts: results.length, limit: hostLimit(env) })
    }
    if (path === '/v1/me' && request.method === 'DELETE') {
      const { results } = await env.DB.prepare('SELECT id FROM host WHERE userId = ?')
        .bind(user.id)
        .all<{ id: string }>()
      for (const host of results) await relay(env, host.id, { role: 'evict' }, new Request('https://relay/'))
      // Sessions, provider accounts and hosts go with the user row.
      await env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(user.id).run()
      return json({ deleted: true })
    }
    if (path === '/v1/hosts' && request.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT id, name, publicKey, online, lastSeenAt FROM host WHERE userId = ? ORDER BY name',
      )
        .bind(user.id)
        .all<{ id: string; name: string; publicKey: string; online: number; lastSeenAt: number | null }>()
      return json({
        hosts: results.map((row) => ({
          hostId: row.id,
          name: row.name,
          publicKey: row.publicKey,
          online: row.online === 1,
          lastSeenAt: row.lastSeenAt,
        })),
        limit: hostLimit(env),
      })
    }
    if (path === '/v1/hosts' && request.method === 'POST') {
      const body = await request.json().catch(() => null)
      const outcome = await registerHost(env, user.id, body)
      if ('error' in outcome) return failure(outcome.error, outcome.status)
      return json(outcome)
    }
    const host = /^\/v1\/hosts\/([0-9a-f]{32})$/.exec(path)
    if (host && request.method === 'DELETE') {
      if (!(await removeHost(env, user.id, host[1]!))) return failure('Not found', 404)
      await relay(env, host[1]!, { role: 'evict' }, new Request('https://relay/'))
      return json({ removed: true })
    }
    return failure('Not found', 404)
  },
} satisfies ExportedHandler<Env>
