// Plans, entitlements and relayed time. An entitlement says what an account has and until when; payment webhooks
// write it, and everything else only reads it. A service that sells nothing (no payment secrets) grants Plus
// to every account, so a self-hosted deployment has every feature and only the host limit it sets itself.
import { LINK_PLANS, type LinkPlan, type LinkPlanStatus } from '@ramu/shared/link/protocol'
import type { Env } from './auth'

type PlanEnv = Pick<
  Env,
  | 'DB'
  | 'HOST_LIMIT'
  | 'PADDLE_API_KEY'
  | 'PADDLE_WEBHOOK_SECRET'
  | 'PADDLE_CLIENT_TOKEN'
  | 'PADDLE_PRICE_YEAR'
  | 'PADDLE_PRICE_MONTH'
>

/** 0, a negative number or nothing removes the limit; it applies only on a service that sells nothing. */
export function hostLimit(env: Pick<Env, 'HOST_LIMIT'>): number | null {
  const parsed = Number(env.HOST_LIMIT ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null
}

/** Plus is for sale only when every Paddle secret and both prices are set. */
export const sellsPlus = (env: Omit<PlanEnv, 'DB' | 'HOST_LIMIT'>) =>
  Boolean(
    env.PADDLE_API_KEY &&
    env.PADDLE_WEBHOOK_SECRET &&
    env.PADDLE_CLIENT_TOKEN &&
    env.PADDLE_PRICE_YEAR &&
    env.PADDLE_PRICE_MONTH,
  )

export interface Entitlement {
  plan: LinkPlan
  source: LinkPlanStatus['source']
  expiresAt: number | null
  renews: boolean
  hostLimit: number | null
  relayedLimitSeconds: number | null
}

interface EntitlementRow {
  plan: string
  source: string
  expiresAt: number | null
  renews: number
}

const limitsOf = (plan: LinkPlan) => ({
  hostLimit: LINK_PLANS[plan].hosts,
  relayedLimitSeconds: LINK_PLANS[plan].relayedHours === null ? null : LINK_PLANS[plan].relayedHours * 3600,
})

export async function entitlementOf(env: PlanEnv, userId: string, now = Date.now()): Promise<Entitlement> {
  if (!sellsPlus(env))
    return {
      plan: 'plus',
      source: 'self-hosted',
      expiresAt: null,
      renews: false,
      hostLimit: hostLimit(env),
      relayedLimitSeconds: null,
    }
  const row = await env.DB.prepare('SELECT plan, source, expiresAt, renews FROM entitlement WHERE userId = ?')
    .bind(userId)
    .first<EntitlementRow>()
  if (row?.plan === 'plus' && (row.expiresAt === null || row.expiresAt > now))
    return {
      plan: 'plus',
      source: 'paddle',
      expiresAt: row.expiresAt,
      renews: row.renews === 1,
      ...limitsOf('plus'),
    }
  return { plan: 'free', source: 'free', expiresAt: null, renews: false, ...limitsOf('free') }
}

export const monthOf = (now: number) => new Date(now).toISOString().slice(0, 7)
export const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10)

export async function relayedSeconds(env: Pick<Env, 'DB'>, userId: string, now = Date.now()): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COALESCE(SUM(seconds), 0) AS seconds FROM usage WHERE userId = ? AND day LIKE ?',
  )
    .bind(userId, `${monthOf(now)}-%`)
    .first<{ seconds: number }>()
  return Number(row?.seconds ?? 0)
}

export async function usageDays(env: Pick<Env, 'DB'>, userId: string, now = Date.now()) {
  const { results } = await env.DB.prepare(
    'SELECT day, seconds, frames FROM usage WHERE userId = ? AND day LIKE ? ORDER BY day',
  )
    .bind(userId, `${monthOf(now)}-%`)
    .all<{ day: string; seconds: number; frames: number }>()
  return results
}

export interface UsageEntry {
  userId: string
  day: string
  seconds: number
  frames: number
}

/** Adds to each account's day; an account deleted meanwhile is skipped rather than failing the rest. */
export async function recordUsage(env: Pick<Env, 'DB'>, entries: UsageEntry[]) {
  for (const entry of entries) {
    if (entry.seconds <= 0 && entry.frames <= 0) continue
    await env.DB.prepare(
      `INSERT INTO usage (userId, day, seconds, frames) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM "user" WHERE id = ?)
       ON CONFLICT(userId, day) DO UPDATE SET seconds = seconds + excluded.seconds, frames = frames + excluded.frames`,
    )
      .bind(entry.userId, entry.day, entry.seconds, entry.frames, entry.userId)
      .run()
  }
}

const hostCount = async (env: Pick<Env, 'DB'>, userId: string) =>
  Number(
    (
      await env.DB.prepare('SELECT COUNT(*) AS count FROM host WHERE userId = ?')
        .bind(userId)
        .first<{ count: number }>()
    )?.count ?? 0,
  )

export async function planStatus(env: PlanEnv, userId: string, now = Date.now()): Promise<LinkPlanStatus> {
  const entitlement = await entitlementOf(env, userId, now)
  return {
    plan: entitlement.plan,
    source: entitlement.source,
    expiresAt: entitlement.expiresAt,
    renews: entitlement.renews,
    hosts: await hostCount(env, userId),
    hostLimit: entitlement.hostLimit,
    month: monthOf(now),
    relayedSeconds: await relayedSeconds(env, userId, now),
    relayedLimitSeconds: entitlement.relayedLimitSeconds,
    checkout: sellsPlus(env),
  }
}

/**
 * Why a new stream to this host is refused under its owner's plan, or null. Open streams are never cut off; a host
 * beyond the plan's limit (the most recently linked ones) stays listed and keeps its data, but takes no new streams.
 * Reasons fit a WebSocket close frame.
 */
export async function streamRefusal(env: PlanEnv, ownerId: string, hostId: string, now = Date.now()) {
  const entitlement = await entitlementOf(env, ownerId, now)
  if (
    entitlement.relayedLimitSeconds !== null &&
    (await relayedSeconds(env, ownerId, now)) >= entitlement.relayedLimitSeconds
  )
    return 'Relayed hours used up this month'
  if (entitlement.hostLimit !== null) {
    const { results } = await env.DB.prepare('SELECT id FROM host WHERE userId = ? ORDER BY createdAt, id LIMIT ?')
      .bind(ownerId, entitlement.hostLimit)
      .all<{ id: string }>()
    if (!results.some((row) => row.id === hostId)) return 'Host beyond the plan limit'
  }
  return null
}
