// Ramu Link on Cloudflare Workers: Better Auth for Google and GitHub sign-in (device-code flow for every Ramu client),
// a registry of the hosts each account linked, the relay that joins a device's stream to its host, and the plan each
// account has (Free, or Plus through Paddle or a grant).
import { LINK_CLOSE, LINK_PROTOCOL, credentialFromProtocols, isHostId } from '@ramu/shared/link/protocol'
import { createAuth, providers, type Auth, type Env } from './auth'
import { checkoutPage, checkoutPolicy, devicePage, language, legalPage } from './page'
import { registerHost, removeHost, type HostRow } from './hosts'
import { applyEvent, cancelSubscription, createCheckout, verifySignature } from './paddle'
import {
  entitlementOf,
  grantPlus,
  monthOf,
  planStatus,
  relayedSeconds,
  revokeGrant,
  sellsPlus,
  streamRefusal,
  usageDays,
} from './plans'
import { addShare, isSharedWith, listShares, ownsHost, removeShare } from './shares'

export { HostRelay } from './relay'

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
const failure = (error: string, status: number, code?: string) => json({ error, ...(code ? { code } : {}) }, status)
const page = (html: string, policy: string) =>
  new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': policy,
      'x-frame-options': 'DENY',
    },
  })
const newNonce = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))

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

/** Sharing and the other features that store data need Plus; a service that sells nothing grants it to everyone. */
const PLUS_REQUIRED = 'Sharing a host needs Ramu Plus.'

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

    const lang = language(request.headers.get('accept-language'))
    if (path === '/device' && request.method === 'GET') {
      const nonce = newNonce()
      return page(
        devicePage(lang, Object.keys(providers(env)), nonce),
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
      )
    }
    if ((path === '/privacy' || path === '/terms') && request.method === 'GET') {
      const nonce = newNonce()
      return page(
        legalPage(path === '/privacy' ? 'privacy' : 'terms', lang, nonce),
        `default-src 'none'; style-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
      )
    }
    if (path === '/checkout' && request.method === 'GET') {
      if (!sellsPlus(env)) return failure('Not found', 404)
      const nonce = newNonce()
      return page(
        checkoutPage(lang, nonce, env.PADDLE_CLIENT_TOKEN!, env.PADDLE_ENV === 'sandbox'),
        checkoutPolicy(nonce),
      )
    }

    if (path === '/health') return json({ ok: true })

    // Paddle's webhooks, signed with the endpoint's secret; anything unsigned or stale is refused before it is read.
    if (path === '/v1/paddle/webhook' && request.method === 'POST') {
      if (!sellsPlus(env)) return failure('Not found', 404)
      const body = await request.text()
      if (!(await verifySignature(env.PADDLE_WEBHOOK_SECRET!, request.headers.get('paddle-signature'), body)))
        return failure('Invalid signature', 401)
      const event = (() => {
        try {
          return JSON.parse(body) as Record<string, unknown>
        } catch {
          return null
        }
      })()
      if (!event) return failure('Invalid event', 400)
      return json({ result: await applyEvent(env, event) })
    }

    // Free Plus for open-source maintainers and students, granted by a person from a GitHub issue.
    if (path === '/v1/admin/grants' && request.method === 'POST') {
      const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
      if (!env.ADMIN_TOKEN || !sameHex(await sha256Hex(token), await sha256Hex(env.ADMIN_TOKEN)))
        return failure('Not found', 404)
      const body = (await request.json().catch(() => null)) as {
        email?: unknown
        until?: unknown
        revoke?: unknown
      } | null
      const email = typeof body?.email === 'string' ? body.email.trim() : ''
      const target = email
        ? await env.DB.prepare('SELECT id FROM "user" WHERE lower(email) = lower(?)')
            .bind(email)
            .first<{ id: string }>()
        : null
      if (!target) return failure('No account uses that email', 404)
      if (body?.revoke === true) {
        await revokeGrant(env, target.id)
        return json({ revoked: true })
      }
      const until = body?.until === null || body?.until === undefined ? null : Number(body.until)
      if (until !== null && (!Number.isFinite(until) || until <= Date.now()))
        return failure('until must be a future time in milliseconds, or null', 400)
      if (!(await grantPlus(env, target.id, until)))
        return failure('This account pays for Plus already; its subscription stays as it is.', 409)
      return json({ granted: true, until })
    }

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
      const host = await env.DB.prepare('SELECT userId FROM host WHERE id = ?').bind(hostId).first<{ userId: string }>()
      const shared = Boolean(host && host.userId !== user.id && (await isSharedWith(env, hostId, user.id)))
      // The same answer for a host that does not exist and one owned by another account that did not share it.
      if (!host || (host.userId !== user.id && !shared)) return refuse(LINK_CLOSE.hostOffline, 'Host offline')
      // Relayed time and the host limit belong to the owner, whoever opens the stream.
      if (shared && (await entitlementOf(env, host.userId)).plan !== 'plus')
        return refuse(LINK_CLOSE.plan, 'Sharing needs the owner to have Plus')
      const refusal = await streamRefusal(env, host.userId, hostId)
      if (refusal) return refuse(LINK_CLOSE.plan, refusal)
      return relay(
        env,
        hostId,
        { role: 'device', account: user.id, owner: host.userId, ...(shared ? { shared: '1' } : {}) },
        request,
      )
    }

    if (!path.startsWith('/v1/')) return failure('Not found', 404)
    const user = await userOf(auth, request.headers)
    if (!user) return failure('Sign in to Ramu Link first', 401)

    if (path === '/v1/me' && request.method === 'GET') {
      const plan = await planStatus(env, user.id)
      return json({ user: { name: user.name, email: user.email }, hosts: plan.hosts, limit: plan.hostLimit, plan })
    }
    if (path === '/v1/usage' && request.method === 'GET') {
      const now = Date.now()
      const { relayedLimitSeconds } = await entitlementOf(env, user.id, now)
      return json({
        month: monthOf(now),
        seconds: await relayedSeconds(env, user.id, now),
        limitSeconds: relayedLimitSeconds,
        days: await usageDays(env, user.id, now),
      })
    }
    if (path === '/v1/checkout' && request.method === 'POST') {
      if (!sellsPlus(env)) return failure('This Ramu Link service does not sell Plus', 404)
      const body = (await request.json().catch(() => null)) as { interval?: unknown } | null
      const interval = body?.interval === 'month' ? 'month' : 'year'
      try {
        return json({ url: await createCheckout(env, user.id, interval) })
      } catch (error) {
        return failure(error instanceof Error ? error.message : 'Checkout is unavailable', 502)
      }
    }
    if (path === '/v1/me' && request.method === 'DELETE') {
      // Nobody keeps paying for an account that is gone: a subscription that cannot be cancelled stops the deletion.
      const subscription = await env.DB.prepare(
        "SELECT subscriptionId FROM entitlement WHERE userId = ? AND subscriptionId IS NOT NULL AND COALESCE(subscriptionStatus, '') != 'canceled'",
      )
        .bind(user.id)
        .first<{ subscriptionId: string }>()
      if (subscription && sellsPlus(env))
        try {
          await cancelSubscription(env, subscription.subscriptionId)
        } catch (error) {
          return failure(
            `Your Plus subscription could not be cancelled, so the account was kept. Try again. (${error instanceof Error ? error.message : 'Paddle'})`,
            502,
          )
        }
      const { results } = await env.DB.prepare('SELECT id FROM host WHERE userId = ?')
        .bind(user.id)
        .all<{ id: string }>()
      for (const host of results) await relay(env, host.id, { role: 'evict' }, new Request('https://relay/'))
      // Sessions, provider accounts and hosts go with the user row.
      await env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(user.id).run()
      return json({ deleted: true })
    }
    if (path === '/v1/hosts' && request.method === 'GET') {
      // The account's own hosts and the ones other accounts shared with it, each marked with whose it is.
      const { results } = await env.DB.prepare(
        `SELECT h.id AS id, h.name AS name, h.publicKey AS publicKey, h.online AS online, h.lastSeenAt AS lastSeenAt,
           h.userId AS userId, u.name AS ownerName
         FROM host h JOIN "user" u ON u.id = h.userId
         WHERE h.userId = ? OR h.id IN (SELECT hostId FROM share WHERE userId = ?) ORDER BY h.name`,
      )
        .bind(user.id, user.id)
        .all<{
          id: string
          name: string
          publicKey: string
          online: number
          lastSeenAt: number | null
          userId: string
          ownerName: string
        }>()
      return json({
        hosts: results.map((row) => ({
          hostId: row.id,
          name: row.name,
          publicKey: row.publicKey,
          online: row.online === 1,
          lastSeenAt: row.lastSeenAt,
          ...(row.userId === user.id ? {} : { sharedBy: row.ownerName }),
        })),
        limit: (await entitlementOf(env, user.id)).hostLimit,
      })
    }
    if (path === '/v1/hosts' && request.method === 'POST') {
      const body = await request.json().catch(() => null)
      const outcome = await registerHost(env, user.id, body)
      if ('error' in outcome) return failure(outcome.error, outcome.status, outcome.code)
      return json(outcome)
    }
    const host = /^\/v1\/hosts\/([0-9a-f]{32})$/.exec(path)
    if (host && request.method === 'DELETE') {
      if (!(await removeHost(env, user.id, host[1]!))) return failure('Not found', 404)
      await relay(env, host[1]!, { role: 'evict' }, new Request('https://relay/'))
      return json({ removed: true })
    }
    const shares = /^\/v1\/hosts\/([0-9a-f]{32})\/shares$/.exec(path)
    if (shares) {
      const hostId = shares[1]!
      if (!(await ownsHost(env, user.id, hostId))) return failure('Not found', 404)
      if (request.method === 'GET') return json({ shares: await listShares(env, hostId) })
      if (request.method === 'POST') {
        if ((await entitlementOf(env, user.id)).plan !== 'plus') return failure(PLUS_REQUIRED, 403, 'plus')
        const outcome = await addShare(env, user.id, hostId, await request.json().catch(() => null))
        if ('error' in outcome) return failure(outcome.error, outcome.status)
        return json(outcome)
      }
    }
    const share = /^\/v1\/hosts\/([0-9a-f]{32})\/shares\/([^/]{1,100})$/.exec(path)
    if (share && request.method === 'DELETE') {
      const [hostId, userId] = [share[1]!, decodeURIComponent(share[2]!)]
      if (!(await removeShare(env, user.id, hostId, userId))) return failure('Not found', 404)
      // Streams that account has open end now, not whenever they next reconnect.
      await relay(env, hostId, { role: 'evict', account: userId }, new Request('https://relay/'))
      return json({ removed: true })
    }
    return failure('Not found', 404)
  },
} satisfies ExportedHandler<Env>
