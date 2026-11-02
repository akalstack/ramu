import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { hostLimit, parseRegistration, registerHost, removeHost } from '../src/hosts'
import { devicePage, language } from '../src/page'

const HOST = '0123456789abcdef0123456789abcdef'
const KEY = 'a'.repeat(64)

/** D1's statement API over a real SQLite database with the service's own migration applied. */
function database() {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(join(import.meta.dirname, '../migrations/0001_init.sql'), 'utf8'))
  const now = new Date().toISOString()
  for (const id of ['u1', 'u2'])
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

  it('limits hosts per account, five unless the deployment says otherwise, and 0 removes the limit', () => {
    expect(hostLimit({})).toBe(5)
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
