import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { parseRegistration, registerHost, removeHost } from '../src/hosts'
import { checkoutPage, devicePage, language, legalPage } from '../src/page'
import { entitlementOf, hostLimit, planStatus, recordUsage, relayedSeconds, streamRefusal } from '../src/plans'
import { RENEWAL_GRACE_MS, applyEvent, verifySignature } from '../src/paddle'
import { addShare, isSharedWith, listShares, removeShare } from '../src/shares'

const HOST = '0123456789abcdef0123456789abcdef'
const KEY = 'a'.repeat(64)

/** D1's statement API over a real SQLite database with the service's own migration applied. */
function database() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const migration of ['0001_init.sql', '0002_plans.sql'])
    db.exec(readFileSync(join(import.meta.dirname, '../migrations', migration), 'utf8'))
  const now = new Date().toISOString()
  for (const id of ['u1', 'u2', 'u3'])
    db.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
    ).run(id, id, `${id}@example.com`, now, now)
  const d1 = {
    prepare(sql: string) {
      return {
        bind(...args: (string | number | null)[]) {
          const statement = db.prepare(sql)
          return {
            first: async () => statement.get(...args) ?? null,
            all: async () => ({ results: statement.all(...args) }),
            run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } }),
          }
        },
      }
    },
  }
  return { db, env: { DB: d1 as unknown as D1Database, HOST_LIMIT: '2' } }
}
/** The settings that make a service sell Plus, so plans and limits apply. */
const SELLING = {
  PADDLE_API_KEY: 'key',
  PADDLE_WEBHOOK_SECRET: 'whsec',
  PADDLE_CLIENT_TOKEN: 'test_token',
  PADDLE_PRICE_YEAR: 'pri_year',
  PADDLE_PRICE_MONTH: 'pri_month',
}
const selling = () => {
  const { db, env } = database()
  return { db, env: { ...env, HOST_LIMIT: undefined, ...SELLING } }
}
/** Plus as a Paddle subscription would leave it, until `expiresAt` (null: renewing with no end recorded). */
const paidPlus = (db: DatabaseSync, userId: string, expiresAt: number | null) =>
  db
    .prepare(
      `INSERT INTO entitlement (userId, plan, source, expiresAt, renews, subscriptionId, subscriptionStatus, updatedAt)
       VALUES (?, 'plus', 'paddle', ?, 1, 'sub_test', 'active', 0)`,
    )
    .run(userId, expiresAt)
const host = (hostId: string, name = 'Studio') => ({ hostId, name, publicKey: KEY })
const id = (n: number) => n.toString(16).padStart(32, '0')

describe('host registry', () => {
  it('accepts only a host id, a name and an identity key, trimming the name', () => {
    expect(parseRegistration({ hostId: HOST, name: '  Studio  ', publicKey: KEY })).toEqual(host(HOST))
    expect(parseRegistration({ hostId: 'nope', name: 'x', publicKey: KEY })).toBeNull()
    expect(parseRegistration({ hostId: HOST, name: '   ', publicKey: KEY })).toBeNull()
    expect(parseRegistration({ hostId: HOST, name: 'x', publicKey: 'short' })).toBeNull()
    expect(parseRegistration(null)).toBeNull()
  })

  it('on a service that sells nothing, limits hosts only as the deployment says', () => {
    expect(hostLimit({})).toBeNull()
    expect(hostLimit({ HOST_LIMIT: '12' })).toBe(12)
    expect(hostLimit({ HOST_LIMIT: '0' })).toBeNull()
  })

  it('links a host with a secret it stores only as a hash, and relinking issues a new one', async () => {
    const { db, env } = database()
    const first = await registerHost(env, 'u1', host(HOST))
    expect(first).toEqual({ secret: expect.stringMatching(new RegExp(`^${HOST}\\.`)) })
    const row = db.prepare('SELECT userId, name, secretHash FROM host WHERE id = ?').get(HOST) as Record<string, string>
    expect(row).toMatchObject({ userId: 'u1', name: 'Studio' })
    expect(row.secretHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(row)).not.toContain((first as { secret: string }).secret)
    const again = await registerHost(env, 'u1', host(HOST, 'Renamed'))
    expect((again as { secret: string }).secret).not.toBe((first as { secret: string }).secret)
    expect(db.prepare('SELECT name FROM host WHERE id = ?').get(HOST)).toEqual({ name: 'Renamed' })
  })

  it('refuses a host linked to another account and a host past the limit', async () => {
    const { env } = database()
    await registerHost(env, 'u1', host(HOST))
    expect(await registerHost(env, 'u2', host(HOST))).toMatchObject({ status: 409 })
    await registerHost(env, 'u1', host(id(1)))
    expect(await registerHost(env, 'u1', host(id(2)))).toMatchObject({ status: 403 })
    // Relinking a host the account already has never counts against the limit.
    expect(await registerHost(env, 'u1', host(id(1)))).toHaveProperty('secret')
  })

  it('removes a host only for the account that linked it', async () => {
    const { env } = database()
    await registerHost(env, 'u1', host(HOST))
    expect(await removeHost(env, 'u2', HOST)).toBe(false)
    expect(await removeHost(env, 'u1', HOST)).toBe(true)
    expect(await removeHost(env, 'u1', HOST)).toBe(false)
  })
})

describe('sign-in page', () => {
  it('speaks Indonesian when the browser prefers it and English otherwise', () => {
    expect(language('id-ID,id;q=0.9,en;q=0.8')).toBe('id')
    expect(language('en-US,en;q=0.9')).toBe('en')
    expect(language('fr-FR')).toBe('en')
    expect(language(null)).toBe('en')
  })

  it('offers only configured providers and runs its script under the nonce', () => {
    const page = devicePage('en', ['github'], 'n0nce')
    expect(page).toContain('data-provider="github"')
    expect(page).not.toContain('data-provider="google"')
    expect(page).toContain('<script nonce="n0nce">')
    expect(devicePage('en', [], 'n')).toContain('no sign-in providers configured')
  })

  it('shows the code from the address as text, so a crafted link cannot inject markup', () => {
    const page = devicePage('en', ['google'], 'n')
    expect(page).toContain("$('code').textContent=code")
    expect(page).not.toContain('innerHTML')
  })
})

const DAY = 24 * 60 * 60 * 1000
const NOV = Date.UTC(2026, 10, 15, 12)

describe('plans', () => {
  it('grants Plus with every feature on a service that sells nothing, and offers no checkout', async () => {
    const { env } = database()
    expect(await entitlementOf(env, 'u1')).toMatchObject({
      plan: 'plus',
      source: 'self-hosted',
      relayedLimitSeconds: null,
    })
    expect(await planStatus(env, 'u1')).toMatchObject({ checkout: false, hostLimit: 2 })
  })

  it('puts an account on Free when the service sells Plus: 3 hosts and 60 relayed hours', async () => {
    const { env } = selling()
    expect(await planStatus(env, 'u1', NOV)).toEqual({
      plan: 'free',
      source: 'free',
      expiresAt: null,
      renews: false,
      hosts: 0,
      hostLimit: 3,
      month: '2026-11',
      relayedSeconds: 0,
      relayedLimitSeconds: 60 * 3600,
      checkout: true,
    })
  })

  it('names the limit and both ways out at a fourth host, and links it once the account has Plus', async () => {
    const { db, env } = selling()
    for (const n of [1, 2, 3]) expect(await registerHost(env, 'u1', host(id(n)))).toHaveProperty('secret')
    const refused = await registerHost(env, 'u1', host(id(4)))
    expect(refused).toMatchObject({ status: 403, code: 'host-limit' })
    expect((refused as { error: string }).error).toMatch(/3 hosts.*Unlink one, or get Plus for up to 20/)
    paidPlus(db, 'u1', null)
    expect(await registerHost(env, 'u1', host(id(4)))).toHaveProperty('secret')
  })

  it('adds relayed time per day and counts only the current month', async () => {
    const { env } = selling()
    await recordUsage(env, [
      { userId: 'u1', day: '2026-11-01', seconds: 100, frames: 4 },
      { userId: 'u1', day: '2026-11-01', seconds: 50, frames: 1 },
      { userId: 'u1', day: '2026-10-31', seconds: 9999, frames: 1 },
      { userId: 'gone', day: '2026-11-01', seconds: 5, frames: 1 },
    ])
    expect(await relayedSeconds(env, 'u1', NOV)).toBe(150)
    expect(await relayedSeconds(env, 'u1', Date.UTC(2026, 11, 1))).toBe(0)
  })

  it('refuses new streams past 60 hours on Free, never on Plus', async () => {
    const { db, env } = selling()
    await registerHost(env, 'u1', host(HOST))
    expect(await streamRefusal(env, 'u1', HOST, NOV)).toBeNull()
    await recordUsage(env, [{ userId: 'u1', day: '2026-11-02', seconds: 60 * 3600, frames: 1 }])
    expect(await streamRefusal(env, 'u1', HOST, NOV)).toBe('Relayed hours used up this month')
    paidPlus(db, 'u1', null)
    expect(await streamRefusal(env, 'u1', HOST, NOV)).toBeNull()
  })

  it('keeps every host after Plus lapses, but only the first 3 linked take new streams', async () => {
    const { db, env } = selling()
    paidPlus(db, 'u1', NOV + DAY)
    for (const n of [1, 2, 3, 4]) await registerHost(env, 'u1', host(id(n)))
    db.prepare('UPDATE host SET createdAt = ? WHERE id = ?').run(1, id(4))
    db.prepare('UPDATE host SET createdAt = ? WHERE id = ?').run(Number.MAX_SAFE_INTEGER, id(1))
    const later = NOV + 2 * DAY
    expect(await streamRefusal(env, 'u1', id(4), later)).toBeNull()
    expect(await streamRefusal(env, 'u1', id(1), later)).toBe('Host beyond the plan limit')
    expect(db.prepare('SELECT COUNT(*) AS count FROM host').get()).toEqual({ count: 4 })
    expect(await streamRefusal(env, 'u1', id(1), NOV)).toBeNull()
  })
})

const signed = async (secret: string, body: string, ts: number) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}:${body}`))
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

describe('Paddle', () => {
  it('accepts only a fresh signature over the exact body, from any current secret', async () => {
    const now = 1_800_000_000_000
    const ts = now / 1000
    const good = await signed('whsec', '{"a":1}', ts)
    expect(await verifySignature('whsec', `ts=${ts};h1=${good}`, '{"a":1}', now)).toBe(true)
    expect(await verifySignature('whsec', `ts=${ts};h1=${'0'.repeat(64)};h1=${good}`, '{"a":1}', now)).toBe(true)
    expect(await verifySignature('whsec', `ts=${ts};h1=${good}`, '{"a":2}', now)).toBe(false)
    expect(await verifySignature('other', `ts=${ts};h1=${good}`, '{"a":1}', now)).toBe(false)
    expect(await verifySignature('whsec', `ts=${ts};h1=${good}`, '{"a":1}', now + 301_000)).toBe(false)
    expect(await verifySignature('whsec', null, '{"a":1}', now)).toBe(false)
  })

  const subscription = (status: string, at: string, extra: Record<string, unknown> = {}) => ({
    event_type: `subscription.${status === 'active' ? 'updated' : status}`,
    occurred_at: at,
    data: {
      id: 'sub_1',
      status,
      custom_data: { account: 'u1' },
      current_billing_period: { ends_at: '2026-12-15T12:00:00Z' },
      ...extra,
    },
  })

  it('turns a subscription into Plus that renews, with a day of grace past the period', async () => {
    const { env } = selling()
    expect(await applyEvent(env, subscription('active', '2026-11-15T12:00:00Z'))).toBe('plus')
    const plus = await entitlementOf(env, 'u1', NOV)
    expect(plus).toMatchObject({ plan: 'plus', source: 'paddle', renews: true, hostLimit: 20 })
    expect(plus.expiresAt).toBe(Date.parse('2026-12-15T12:00:00Z') + RENEWAL_GRACE_MS)
  })

  it('keeps a cancelled subscription until its period ends, then Free; renewing restores Plus', async () => {
    const { env } = selling()
    await applyEvent(env, subscription('active', '2026-11-15T12:00:00Z'))
    await applyEvent(
      env,
      subscription('active', '2026-11-20T12:00:00Z', {
        scheduled_change: { action: 'cancel', effective_at: '2026-12-15T12:00:00Z' },
      }),
    )
    expect(await entitlementOf(env, 'u1', Date.parse('2026-12-01'))).toMatchObject({ plan: 'plus', renews: false })
    expect((await entitlementOf(env, 'u1', Date.parse('2026-12-16'))).plan).toBe('free')
    await applyEvent(env, subscription('canceled', '2026-12-15T12:00:01Z'))
    await applyEvent(
      env,
      subscription('active', '2026-12-20T12:00:00Z', { current_billing_period: { ends_at: '2027-01-20T12:00:00Z' } }),
    )
    expect((await entitlementOf(env, 'u1', Date.parse('2026-12-21'))).plan).toBe('plus')
  })

  it('ends Plus on a failed renewal and on a refund, and ignores an event older than the last', async () => {
    const { env } = selling()
    await applyEvent(env, subscription('active', '2026-11-15T12:00:00Z'))
    expect(await applyEvent(env, subscription('past_due', '2026-11-16T12:00:00Z'))).toBe('ended')
    expect((await entitlementOf(env, 'u1', NOV)).plan).toBe('free')
    await applyEvent(env, subscription('active', '2026-11-15T13:00:00Z'))
    expect((await entitlementOf(env, 'u1', NOV)).plan).toBe('free')
    await applyEvent(env, subscription('active', '2026-11-17T12:00:00Z'))
    expect((await entitlementOf(env, 'u1', NOV)).plan).toBe('plus')
    const refund = {
      event_type: 'adjustment.updated',
      occurred_at: '2026-11-18T12:00:00Z',
      data: { action: 'refund', status: 'approved', subscription_id: 'sub_1' },
    }
    expect(await applyEvent(env, refund)).toBe('ended')
    expect((await entitlementOf(env, 'u1', NOV)).plan).toBe('free')
  })

  it('ignores events for accounts it does not know and kinds it does not handle', async () => {
    const { env } = selling()
    const stranger = subscription('active', '2026-11-15T12:00:00Z', { custom_data: { account: 'nobody' } })
    expect(await applyEvent(env, stranger)).toBe('plus')
    expect((await entitlementOf(env, 'nobody', NOV)).plan).toBe('free')
    expect(await applyEvent(env, { event_type: 'transaction.completed', data: {} })).toBe('ignored')
  })
})

describe('sharing', () => {
  it('shares a host with an existing account by email, and either side can end it', async () => {
    const { env } = selling()
    await registerHost(env, 'u1', host(HOST))
    expect(await addShare(env, 'u1', HOST, { email: 'nobody@example.com' })).toMatchObject({ status: 404 })
    expect(await addShare(env, 'u1', HOST, { email: 'u1@example.com' })).toMatchObject({ status: 400 })
    expect(await addShare(env, 'u1', HOST, { email: 'U2@example.com' })).toMatchObject({ share: { userId: 'u2' } })
    expect(await isSharedWith(env, HOST, 'u2')).toBe(true)
    expect((await listShares(env, HOST)).map((share) => share.email)).toEqual(['u2@example.com'])
    expect(await removeShare(env, 'u3', HOST, 'u2')).toBe(false)
    expect(await removeShare(env, 'u2', HOST, 'u2')).toBe(true)
    await addShare(env, 'u1', HOST, { email: 'u2@example.com' })
    expect(await removeShare(env, 'u1', HOST, 'u2')).toBe(true)
    expect(await isSharedWith(env, HOST, 'u2')).toBe(false)
  })

  it('ends shares with the host', async () => {
    const { env } = selling()
    await registerHost(env, 'u1', host(HOST))
    await addShare(env, 'u1', HOST, { email: 'u2@example.com' })
    await removeHost(env, 'u1', HOST)
    expect(await isSharedWith(env, HOST, 'u2')).toBe(false)
  })
})

describe('checkout and notices', () => {
  it('opens Paddle in the sandbox only when told to, with the client token only', () => {
    expect(checkoutPage('en', 'n', 'test_tok', true)).toContain("Paddle.Environment.set('sandbox')")
    const live = checkoutPage('id', 'n', 'live_tok', false)
    expect(live).not.toContain('sandbox')
    expect(live).toContain('"live_tok"')
    expect(live).toContain('Pembayaran diterima')
  })

  it('serves the privacy notice and terms as fixed text in both languages', () => {
    expect(legalPage('privacy', 'en', 'n')).toContain('end-to-end encrypted')
    expect(legalPage('terms', 'id', 'n')).toContain('60 jam')
    expect(legalPage('terms', 'en', 'n')).not.toContain('<script')
  })
})
