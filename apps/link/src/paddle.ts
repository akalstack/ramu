// Paddle as merchant of record: it charges, collects tax in the buyer's country and sets the rupiah price for
// Indonesia (a per-country price on each Paddle price). Ramu Link keeps only the entitlement its webhooks describe.
import type { LinkBillingInterval } from '@ramu/shared/link/protocol'
import type { Env } from './auth'

type PaddleEnv = Pick<Env, 'PADDLE_ENV' | 'PADDLE_API_KEY' | 'PADDLE_PRICE_YEAR' | 'PADDLE_PRICE_MONTH'>

const api = (env: Pick<Env, 'PADDLE_ENV'>) =>
  env.PADDLE_ENV === 'sandbox' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com'

/** A webhook older or newer than this is refused, so a captured one cannot be replayed later. */
const SIGNATURE_TOLERANCE_S = 300
/** Plus outlasts a renewing period by a day, so a renewal webhook that arrives late never interrupts anyone. */
export const RENEWAL_GRACE_MS = 24 * 60 * 60 * 1000

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Checks `Paddle-Signature: ts=…;h1=…` (several `h1` while a secret rotates) against the raw body. */
export async function verifySignature(secret: string, header: string | null, body: string, now = Date.now()) {
  const fields = (header ?? '').split(';').map((part) => part.trim().split('='))
  const ts = fields.find(([key]) => key === 'ts')?.[1] ?? ''
  const signatures = fields.filter(([key]) => key === 'h1').map(([, value]) => value ?? '')
  if (!/^\d+$/.test(ts) || !signatures.length || Math.abs(now / 1000 - Number(ts)) > SIGNATURE_TOLERANCE_S) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}:${body}`)))
  return signatures.some((signature) => sameText(signature, expected))
}

interface Subscription {
  id: string
  status: string
  custom_data?: { account?: unknown } | null
  current_billing_period?: { ends_at?: string } | null
  scheduled_change?: { action?: string; effective_at?: string } | null
}
interface Adjustment {
  action?: string
  status?: string
  subscription_id?: string | null
}
interface PaddleEvent {
  event_type?: unknown
  occurred_at?: unknown
  data?: unknown
}

const time = (value: string | undefined) => {
  const parsed = value ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Ends Plus from one subscription now; a grant or a different subscription on the account is left alone. A refund
 * leaves Paddle's status as it was (Paddle reports the cancellation itself).
 */
async function end(env: Pick<Env, 'DB'>, subscriptionId: string, at: number, status: string | null) {
  await env.DB.prepare(
    `UPDATE entitlement SET plan = 'free', expiresAt = ?, renews = 0, updatedAt = ?,
       subscriptionStatus = COALESCE(?, subscriptionStatus)
     WHERE subscriptionId = ? AND updatedAt <= ?`,
  )
    .bind(at, at, status, subscriptionId, at)
    .run()
}

/**
 * Applies one verified webhook. Events can arrive late or out of order, so each write only replaces an older one.
 * Returns what changed, for the response body and tests.
 */
export async function applyEvent(env: Pick<Env, 'DB'>, event: PaddleEvent): Promise<'plus' | 'ended' | 'ignored'> {
  const type = typeof event.event_type === 'string' ? event.event_type : ''
  const at = time(typeof event.occurred_at === 'string' ? event.occurred_at : undefined) ?? Date.now()
  if (type.startsWith('adjustment.')) {
    const adjustment = (event.data ?? {}) as Adjustment
    if (
      (adjustment.action === 'refund' || adjustment.action === 'chargeback') &&
      adjustment.status === 'approved' &&
      typeof adjustment.subscription_id === 'string'
    ) {
      await end(env, adjustment.subscription_id, at, null)
      return 'ended'
    }
    return 'ignored'
  }
  if (!type.startsWith('subscription.')) return 'ignored'
  const subscription = (event.data ?? {}) as Subscription
  if (typeof subscription.id !== 'string') return 'ignored'
  if (subscription.status !== 'active' && subscription.status !== 'trialing') {
    // Past due (a failed renewal), paused or cancelled: Plus ends now, and comes back with the next active event.
    await end(env, subscription.id, at, subscription.status)
    return 'ended'
  }
  const account = subscription.custom_data?.account
  const known = await env.DB.prepare('SELECT userId FROM entitlement WHERE subscriptionId = ?')
    .bind(subscription.id)
    .first<{ userId: string }>()
  const userId = known?.userId ?? (typeof account === 'string' ? account : null)
  if (!userId) return 'ignored'
  const cancelling = subscription.scheduled_change?.action === 'cancel'
  const periodEnd = time(subscription.current_billing_period?.ends_at ?? undefined)
  const expiresAt = cancelling
    ? (time(subscription.scheduled_change?.effective_at) ?? periodEnd)
    : periodEnd === null
      ? null
      : periodEnd + RENEWAL_GRACE_MS
  await env.DB.prepare(
    `INSERT INTO entitlement (userId, plan, source, expiresAt, renews, subscriptionId, subscriptionStatus, updatedAt)
     SELECT ?, 'plus', 'paddle', ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM "user" WHERE id = ?)
     ON CONFLICT(userId) DO UPDATE SET plan = 'plus', source = 'paddle', expiresAt = excluded.expiresAt,
       renews = excluded.renews, subscriptionId = excluded.subscriptionId,
       subscriptionStatus = excluded.subscriptionStatus, updatedAt = excluded.updatedAt
     WHERE entitlement.updatedAt <= excluded.updatedAt`,
  )
    .bind(userId, expiresAt, cancelling ? 0 : 1, subscription.id, subscription.status, at, userId)
    .run()
  return 'plus'
}

async function paddle<T>(env: PaddleEnv, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${api(env)}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.PADDLE_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const value = (await response.json().catch(() => ({}))) as { data?: T; error?: { detail?: string } }
  if (!response.ok || !value.data) throw new Error(value.error?.detail ?? `Paddle answered ${response.status}`)
  return value.data
}

/**
 * A checkout for this account. Paddle opens it on the service's own `/checkout` page (set as the default payment link
 * in Paddle), with the price for the buyer's country.
 */
export async function createCheckout(env: PaddleEnv, userId: string, interval: LinkBillingInterval): Promise<string> {
  const price = interval === 'year' ? env.PADDLE_PRICE_YEAR : env.PADDLE_PRICE_MONTH
  const transaction = await paddle<{ checkout?: { url?: string | null } | null }>(env, '/transactions', {
    items: [{ price_id: price, quantity: 1 }],
    custom_data: { account: userId },
  })
  const url = transaction.checkout?.url
  if (!url) throw new Error('Set a default payment link in Paddle first')
  return url
}

/** Cancels at once, before an account is deleted, so nobody keeps paying for an account that no longer exists. */
export async function cancelSubscription(env: PaddleEnv, subscriptionId: string) {
  await paddle(env, `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { effective_from: 'immediately' })
}
