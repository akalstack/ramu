import { LINK_PLANS, isHostId } from '@ramu/shared/link/protocol'
import type { Env } from './auth'
import { entitlementOf } from './plans'

export interface HostRow {
  secretHash: string
}

const KEY = /^[0-9a-f]{64}$/

export function parseRegistration(body: unknown): { hostId: string; name: string; publicKey: string } | null {
  const value = body as { hostId?: unknown; name?: unknown; publicKey?: unknown } | null
  if (!value || typeof value !== 'object') return null
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 80) : ''
  if (!isHostId(value.hostId) || !name || typeof value.publicKey !== 'string' || !KEY.test(value.publicKey)) return null
  return { hostId: value.hostId, name, publicKey: value.publicKey }
}

const randomSecret = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Links a host to this account, or relinks it (a new secret, name and key) when it is already this account's. A host
 * linked to another account is refused: that account must unlink it first.
 */
export async function registerHost(
  env: Parameters<typeof entitlementOf>[0],
  userId: string,
  body: unknown,
): Promise<{ secret: string } | { error: string; status: number; code?: 'host-limit' }> {
  const registration = parseRegistration(body)
  if (!registration) return { error: 'Invalid host', status: 400 }
  const existing = await env.DB.prepare('SELECT userId FROM host WHERE id = ?')
    .bind(registration.hostId)
    .first<{ userId: string }>()
  if (existing && existing.userId !== userId)
    return { error: 'This host is linked to another account. Unlink it there first.', status: 409 }
  const entitlement = await entitlementOf(env, userId)
  const limit = entitlement.hostLimit
  if (!existing && limit !== null) {
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM host WHERE userId = ?')
      .bind(userId)
      .first<{ count: number }>()
    if ((count?.count ?? 0) >= limit)
      return {
        error:
          entitlement.source === 'free'
            ? `This account already links ${limit} hosts, the most the Free plan includes. Unlink one, or get Plus for up to ${LINK_PLANS.plus.hosts}.`
            : `This account already links ${limit} hosts. Unlink one to add another.`,
        status: 403,
        code: 'host-limit',
      }
  }
  const secret = `${registration.hostId}.${randomSecret()}`
  const secretHash = await sha256Hex(secret)
  await env.DB.prepare(
    `INSERT INTO host (id, userId, name, publicKey, secretHash, online, lastSeenAt, createdAt)
     VALUES (?, ?, ?, ?, ?, 0, NULL, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, publicKey = excluded.publicKey, secretHash = excluded.secretHash`,
  )
    .bind(registration.hostId, userId, registration.name, registration.publicKey, secretHash, Date.now())
    .run()
  return { secret }
}

export async function removeHost(env: Pick<Env, 'DB'>, userId: string, hostId: string): Promise<boolean> {
  const result = await env.DB.prepare('DELETE FROM host WHERE id = ? AND userId = ?').bind(hostId, userId).run()
  return (result.meta.changes ?? 0) > 0
}
