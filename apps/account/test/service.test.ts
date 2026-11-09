// Runs against a throwaway Postgres: `DATABASE_URL` when set (CI starts a postgres service), else a container from
// Docker, else the suite is skipped. Proving it on plain Postgres is what shows the service needs nothing else.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  exchangeCommit,
  exchangeKeys,
  exchangeSecrets,
  newBackupKey,
  open,
  seal,
  toBase64,
  fromBase64,
} from '@ramu/shared/accountCrypto'
import { createApp } from '../src/app'
import { createAuth } from '../src/auth'
import { migrate } from '../src/migrate'

const random = (n: number) => new Uint8Array(randomBytes(n))
/** The JSON answers these endpoints give, by field. */
interface Json {
  id: string
  ciphertext: string
  approverKey: string
  envelope: string
  versions: { id: string }[]
  0: { id: string; versions: { id: string }[] }
  map<T>(fn: (entry: { id: string }) => T): T[]
}
let container: string | null = null
let url = process.env.DATABASE_URL ?? ''

function startPostgres(): string | null {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' })
  } catch {
    return null
  }
  const name = `ramu-account-test-${process.pid}`
  execFileSync('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    name,
    '-e',
    'POSTGRES_PASSWORD=ramu',
    '-e',
    'POSTGRES_DB=account',
    '-p',
    '127.0.0.1::5432',
    'postgres:17-alpine',
  ])
  container = name
  const port = execFileSync('docker', ['port', name, '5432/tcp']).toString().trim().split(':').pop()
  return `postgres://postgres:ramu@127.0.0.1:${port}/account`
}

async function ready(connection: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const client = new pg.Client({ connectionString: connection })
    try {
      await client.connect()
      await client.query('select 1')
      await client.end()
      return
    } catch {
      await client.end().catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error('Postgres did not start')
}

const available =
  !!url ||
  (() => {
    try {
      execFileSync('docker', ['info'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })()

describe.skipIf(!available)('the account service on plain Postgres', () => {
  let pool: pg.Pool
  let app: ReturnType<typeof createApp>
  let auth: ReturnType<typeof createAuth>
  let clock = Date.now()

  beforeAll(async () => {
    if (!url) url = startPostgres()!
    await ready(url)
    pool = new pg.Pool({ connectionString: url })
    expect(await migrate(pool)).toEqual(['0001_auth.sql', '0002_ramu.sql'])
    expect(await migrate(pool)).toEqual([])
    auth = createAuth(pool, { baseURL: 'http://localhost:8787', secret: 'a'.repeat(40), passkeyDomain: 'localhost' })
    app = createApp(pool, auth, { now: () => clock })
  }, 120_000)

  afterAll(async () => {
    await pool?.end()
    if (container) execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' })
  })

  /** A signed-in client, as the device flow leaves one: a session token used as a bearer token. */
  async function client(email: string) {
    const context = await auth.$context
    const user =
      (await context.internalAdapter.findUserByEmail(email))?.user ??
      (await context.internalAdapter.createUser(
        { email, name: email.split('@')[0]!, emailVerified: true },
        undefined as never,
      ))
    const session = await context.internalAdapter.createSession(user.id)
    const call = async (method: string, path: string, body?: unknown) => {
      const response = await app.request(path, {
        method,
        headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: response.status, body: (await response.json()) as Json }
    }
    return { call, userId: user.id }
  }

  it('keeps sealed backups it cannot read, the last 30 of each slot, at most once a minute', async () => {
    const host = await client('ada@example.com')
    const key = newBackupKey(random)
    const slot = 'a'.repeat(32)
    const sealed = seal(key, new TextEncoder().encode('{"accent":"teal","name":"ada-mac"}'), random, slot)
    const label = seal(key, new TextEncoder().encode('ada-mac'), random, `${slot}:label`)
    for (let i = 0; i < 32; i++) {
      clock += 61_000
      const put = await host.call('PUT', `/api/backups/${slot}`, {
        kind: 'host',
        label: toBase64(label),
        ciphertext: toBase64(sealed),
      })
      expect(put.status).toBe(200)
    }
    const early = await host.call('PUT', `/api/backups/${slot}`, {
      kind: 'host',
      label: toBase64(label),
      ciphertext: toBase64(sealed),
    })
    expect(early.status).toBe(429)
    const list = await host.call('GET', '/api/backups')
    expect(list.body[0].versions).toHaveLength(30)
    const latest = await host.call('GET', `/api/backups/${slot}/${list.body[0].versions[0]!.id}`)
    expect(open(key, fromBase64(latest.body.ciphertext as string), slot).plaintext).toEqual(
      new TextEncoder().encode('{"accent":"teal","name":"ada-mac"}'),
    )
    // A database dump shows no setting value, host name or setting key in any backup row.
    const dump = await pool.query('select * from backup_slot s join backup_version v on v.slot_id = s.id')
    const raw = JSON.stringify(
      dump.rows.map((row) => ({
        ...row,
        ciphertext: Buffer.from(row.ciphertext).toString('latin1'),
        label: Buffer.from(row.label).toString('latin1'),
      })),
    )
    expect(raw).not.toMatch(/accent|teal|ada-mac/)
    const big = await host.call('PUT', `/api/backups/${'b'.repeat(32)}`, {
      kind: 'host',
      label: toBase64(label),
      ciphertext: toBase64(random(300 * 1024)),
    })
    expect(big.status).toBeGreaterThanOrEqual(400)
  })

  it('hands the backup key to a new device after both show the same number', async () => {
    const trusted = await client('grace@example.com')
    const fresh = await client('grace@example.com')
    const requester = exchangeKeys(random)
    const asked = await fresh.call('POST', '/api/key-requests', {
      name: 'New Mac',
      commit: exchangeCommit(requester.publicKey),
    })
    const id = asked.body.id as string
    expect((await fresh.call('GET', '/api/key-requests')).body).toEqual([])
    const seen = await trusted.call('GET', '/api/key-requests')
    expect(seen.body.map((entry) => entry.id)).toEqual([id])
    const approver = exchangeKeys(random)
    expect(
      (await trusted.call('POST', `/api/key-requests/${id}/offer`, { approverKey: approver.publicKey })).status,
    ).toBe(200)
    const offered = await fresh.call('GET', `/api/key-requests/${id}`)
    expect(
      (await fresh.call('POST', `/api/key-requests/${id}/reveal`, { requesterKey: requester.publicKey })).status,
    ).toBe(200)
    const transcript = {
      requestId: id,
      commit: exchangeCommit(requester.publicKey),
      requesterKey: requester.publicKey,
      approverKey: offered.body.approverKey as string,
    }
    const theirs = exchangeSecrets(approver.secret, requester.publicKey, transcript)
    const mine = exchangeSecrets(requester.secret, transcript.approverKey, transcript)
    expect(mine.code).toBe(theirs.code)
    const backupKey = newBackupKey(random)
    await trusted.call('POST', `/api/key-requests/${id}/approve`, {
      envelope: toBase64(seal(theirs.key, backupKey, random, `key:${id}`)),
    })
    const delivered = await fresh.call('GET', `/api/key-requests/${id}`)
    expect(open(mine.key, fromBase64(delivered.body.envelope as string), `key:${id}`).plaintext).toEqual(backupKey)
    // Delivered once, then gone.
    expect((await fresh.call('GET', `/api/key-requests/${id}`)).status).toBe(404)
  })

  it('relays pairing messages only between one account’s devices and its listed host, within bounds', async () => {
    const host = await client('linus@example.com')
    const phone = await client('linus@example.com')
    const stranger = await client('mallory@example.com')
    const listed = await host.call('PUT', '/api/hosts', { name: 'home-server', hostKey: 'k'.repeat(64) })
    const hostId = listed.body.id as string
    expect((await phone.call('GET', '/api/hosts')).body).toMatchObject([{ id: hostId, name: 'home-server' }])
    expect(
      (await stranger.call('POST', `/api/hosts/${hostId}/relay`, { path: '/pair/request', body: {} })).status,
    ).toBe(404)
    const sent = await phone.call('POST', `/api/hosts/${hostId}/relay`, {
      path: '/pair/request',
      body: { commit: 'c'.repeat(64) },
    })
    expect(sent.status).toBe(200)
    expect((await phone.call('POST', `/api/hosts/${hostId}/relay`, { path: '/pair/request', body: {} })).status).toBe(
      429,
    )
    const waiting = await host.call('GET', `/api/hosts/${hostId}/messages`)
    expect(waiting.body).toMatchObject([{ path: '/pair/request', body: { commit: 'c'.repeat(64) } }])
    expect((await phone.call('GET', `/api/relay/${sent.body.id}`)).body).toEqual({ waiting: true })
    await host.call('POST', `/api/hosts/${hostId}/messages/${waiting.body[0].id}`, {
      reply: { status: 200, body: { requestId: 'r' } },
    })
    expect((await phone.call('GET', `/api/relay/${sent.body.id}`)).body).toEqual({
      waiting: false,
      reply: { status: 200, body: { requestId: 'r' } },
    })
    // The first request was answered and read, so five more may wait; a sixth is refused.
    for (let i = 0; i < 6; i++) {
      const device = await client('linus@example.com')
      const asked = await device.call('POST', `/api/hosts/${hostId}/relay`, { path: '/pair/request', body: {} })
      expect(asked.status).toBe(i < 5 ? 200 : 429)
    }
    // The database holds the host's name and key, never an address.
    const rows = JSON.stringify((await pool.query('select * from listed_host')).rows)
    expect(rows).toContain('home-server')
    expect(rows).not.toMatch(/https?:\/\/|\d+\.\d+\.\d+\.\d+/)
  })

  it('Delete account leaves no rows for the person', async () => {
    const person = await client('del@example.com')
    await person.call('PUT', '/api/recovery', { sealed: toBase64(random(64)) })
    clock += 61_000
    await person.call('PUT', `/api/backups/${'c'.repeat(32)}`, {
      kind: 'phone',
      label: toBase64(random(40)),
      ciphertext: toBase64(random(100)),
    })
    await person.call('PUT', '/api/hosts', { name: 'laptop', hostKey: 'z'.repeat(64) })
    expect((await person.call('DELETE', '/api/me')).status).toBe(200)
    for (const table of ['"session"', 'backup_slot', 'recovery_key', 'listed_host', 'key_request'])
      expect(
        (
          await pool.query(
            `select count(*)::int as n from ${table} where ${table === '"session"' ? '"userId"' : 'user_id'} = $1`,
            [person.userId],
          )
        ).rows[0].n,
      ).toBe(0)
  })
})
