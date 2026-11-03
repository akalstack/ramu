// Sharing a host with another Ramu Link account, a Plus feature. A share only lets that account open relay streams to
// the host; the host still pairs it like any device, and only as a viewer.
import type { Env } from './auth'

/** Enough for a small team looking over someone's work; a team plan is a separate, later option. */
export const MAX_SHARES_PER_HOST = 10

export interface ShareRow {
  userId: string
  name: string
  email: string
  createdAt: number
}

export async function ownsHost(env: Pick<Env, 'DB'>, userId: string, hostId: string) {
  return Boolean(
    await env.DB.prepare('SELECT 1 AS owned FROM host WHERE id = ? AND userId = ?').bind(hostId, userId).first(),
  )
}

export async function listShares(env: Pick<Env, 'DB'>, hostId: string): Promise<ShareRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT s.userId AS userId, u.name AS name, u.email AS email, s.createdAt AS createdAt
     FROM share s JOIN "user" u ON u.id = s.userId WHERE s.hostId = ? ORDER BY s.createdAt`,
  )
    .bind(hostId)
    .all<ShareRow>()
  return results
}

/** The owner must already have checked Plus and ownership. */
export async function addShare(
  env: Pick<Env, 'DB'>,
  ownerId: string,
  hostId: string,
  body: unknown,
  now = Date.now(),
): Promise<{ share: ShareRow } | { error: string; status: number }> {
  const email = (body as { email?: unknown } | null)?.email
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(email.trim()) || email.length > 320)
    return { error: 'Enter the email address of a Ramu Link account', status: 400 }
  const user = await env.DB.prepare('SELECT id, name, email FROM "user" WHERE lower(email) = lower(?)')
    .bind(email.trim())
    .first<{ id: string; name: string; email: string }>()
  if (!user)
    return { error: 'No Ramu Link account uses that email. Ask them to sign in to Ramu Link once first.', status: 404 }
  if (user.id === ownerId) return { error: 'This host is already yours', status: 400 }
  const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM share WHERE hostId = ?')
    .bind(hostId)
    .first<{ count: number }>()
  if (Number(count?.count ?? 0) >= MAX_SHARES_PER_HOST)
    return { error: `A host can be shared with ${MAX_SHARES_PER_HOST} accounts. Remove one first.`, status: 403 }
  await env.DB.prepare('INSERT INTO share (hostId, userId, createdAt) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
    .bind(hostId, user.id, now)
    .run()
  return { share: { userId: user.id, name: user.name, email: user.email, createdAt: now } }
}

/** The owner removes anyone; a shared account can remove only itself. */
export async function removeShare(env: Pick<Env, 'DB'>, callerId: string, hostId: string, userId: string) {
  if (callerId !== userId && !(await ownsHost(env, callerId, hostId))) return false
  const result = await env.DB.prepare('DELETE FROM share WHERE hostId = ? AND userId = ?').bind(hostId, userId).run()
  return (result.meta.changes ?? 0) > 0
}

export async function isSharedWith(env: Pick<Env, 'DB'>, hostId: string, userId: string) {
  return Boolean(
    await env.DB.prepare('SELECT 1 AS shared FROM share WHERE hostId = ? AND userId = ?').bind(hostId, userId).first(),
  )
}
