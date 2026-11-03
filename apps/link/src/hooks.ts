// Webhook requests for linked hosts: sealed at once to the host's identity key, passed to the host over the relay, and
// held for a day when the host is offline (a Plus feature; a service that sells nothing holds for everyone).
import { HOOK_HOLD_MS, MAX_HELD_HOOKS, hookHeaders, sealHook } from '@ramu/shared/link/hooks'
import { MAX_WEBHOOK_BODY_BYTES } from '@ramu/shared/webhooks'
import type { Env } from './auth'
import { entitlementOf } from './plans'

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/
const random = (bytes: number) => crypto.getRandomValues(new Uint8Array(bytes))
const base64 = (bytes: Uint8Array) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export type HookOutcome =
  { status: 202; held: boolean } | { status: 404 | 413 | 503; error: string; retryAfter?: number }

/**
 * Reads, seals and hands over one request. `deliver` asks the host's relay to pass it on and says whether the host
 * was there to take it.
 */
export async function acceptHook(
  env: Parameters<typeof entitlementOf>[0],
  hostId: string,
  token: string,
  request: Request,
  deliver: (sealed: string) => Promise<boolean>,
  now = Date.now(),
): Promise<HookOutcome> {
  if (!TOKEN.test(token)) return { status: 404, error: 'Not found' }
  const host = await env.DB.prepare('SELECT userId, publicKey FROM host WHERE id = ?')
    .bind(hostId)
    .first<{ userId: string; publicKey: string }>()
  if (!host) return { status: 404, error: 'Not found' }
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_WEBHOOK_BODY_BYTES) return { status: 413, error: 'The request is too large' }
  const raw = new Uint8Array(await request.arrayBuffer())
  if (raw.length > MAX_WEBHOOK_BODY_BYTES) return { status: 413, error: 'The request is too large' }
  const sealed = sealHook(
    { token, headers: hookHeaders(request.headers.entries()), body: base64(raw), receivedAt: now },
    host.publicKey,
    random,
  )
  if (await deliver(sealed)) return { status: 202, held: false }
  if ((await entitlementOf(env, host.userId, now)).plan !== 'plus')
    // Senders retry on a 5xx, so a host that wakes soon still gets the request without holding it here.
    return { status: 503, error: 'The host is offline', retryAfter: 300 }
  await env.DB.prepare('DELETE FROM held_hook WHERE hostId = ? AND expiresAt <= ?').bind(hostId, now).run()
  await env.DB.prepare(
    `DELETE FROM held_hook WHERE id IN (SELECT id FROM held_hook WHERE hostId = ? ORDER BY receivedAt DESC LIMIT -1 OFFSET ?)`,
  )
    .bind(hostId, MAX_HELD_HOOKS - 1)
    .run()
  await env.DB.prepare('INSERT INTO held_hook (id, hostId, sealed, receivedAt, expiresAt) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), hostId, sealed, now, now + HOOK_HOLD_MS)
    .run()
  return { status: 202, held: true }
}

/** Requests held for a host, oldest first, removed as they are handed over. */
export async function takeHeld(env: Pick<Env, 'DB'>, hostId: string, now = Date.now()) {
  const { results } = await env.DB.prepare(
    'SELECT id, sealed, receivedAt FROM held_hook WHERE hostId = ? AND expiresAt > ? ORDER BY receivedAt',
  )
    .bind(hostId, now)
    .all<{ id: string; sealed: string; receivedAt: number }>()
  await env.DB.prepare('DELETE FROM held_hook WHERE hostId = ?').bind(hostId).run()
  return results
}
