// The account service: a small Hono app on plain Postgres. It stores sealed backups it cannot read, relays the key
// exchange that brings the backup key to a new device, lists hosts the person chose to list, and relays pairing
// messages between a signed-in device and a listed host. It never grants access to a host: the host approves every
// device itself, as it does a nearby one.
import { createHash, randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import type { Pool } from 'pg'
import { z } from 'zod'
import { ACCOUNT_LIMITS } from '@ramu/shared/account'
import type { Auth } from './auth'
import { devicePage } from './page'

type Session = { userId: string; sessionId: string }
type Env = { Variables: { session: Session } }

const b64 = z
  .string()
  .max(Math.ceil((ACCOUNT_LIMITS.backupBytes * 4) / 3) + 8)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/)
const hex64 = z.string().regex(/^[0-9a-f]{64}$/)
const slotId = z.string().regex(/^[0-9a-f]{32}$/)
const uuid = z.uuid()

const bytes = (value: string) => Buffer.from(value, 'base64')
const iso = (value: Date | string | null) => (value ? new Date(value).getTime() : null)

export function createApp(pool: Pool, auth: Auth, options: { now?: () => number } = {}) {
  const now = () => options.now?.() ?? Date.now()
  const app = new Hono<Env>()
  const q = <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    pool.query(text, values).then((result) => result.rows as T[])

  app.onError((error, c) => {
    if (error instanceof z.ZodError) return c.json({ error: 'That request is not one the service takes.' }, 400)
    if (error instanceof Refusal) return c.json({ error: error.message }, error.status)
    console.error(error)
    return c.json({ error: 'The account service could not do that. Try again.' }, 500)
  })

  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))
  app.get('/device', (c) => c.html(devicePage(c.req.query('user_code') ?? '')))
  app.get('/', (c) => c.redirect('https://getramu.dev'))
  app.get('/health', async (c) => {
    await q('select 1')
    return c.json({ ok: true })
  })

  // Everything else needs a session: a cookie from the sign-in page, or the bearer token the device flow gave a client.
  app.use('/api/*', async (c, next) => {
    const found = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!found) return c.json({ error: 'Sign in again.' }, 401)
    c.set('session', { userId: found.user.id, sessionId: found.session.id })
    await next()
  })
  const me = (c: Context<Env>) => c.get('session')

  app.get('/api/me', async (c) => {
    const [user] = await q<{ id: string; name: string; email: string; image: string | null }>(
      'select id, name, email, image from "user" where id = $1',
      [me(c).userId],
    )
    return c.json(user)
  })

  /** Delete account: every row for the person goes at once, backups included. */
  app.delete('/api/me', async (c) => {
    await q('delete from "user" where id = $1', [me(c).userId])
    return c.json({ deleted: true })
  })

  // ---- Backups ----

  app.get('/api/backups', async (c) => {
    const slots = await q<{ id: string; slot: string; kind: 'host' | 'phone'; label: Buffer }>(
      'select id, slot, kind, label from backup_slot where user_id = $1 order by created_at',
      [me(c).userId],
    )
    const versions = await q<{ id: string; slot_id: string; size: number; created_at: Date }>(
      'select v.id, v.slot_id, v.size, v.created_at from backup_version v join backup_slot s on s.id = v.slot_id where s.user_id = $1 order by v.created_at desc',
      [me(c).userId],
    )
    return c.json(
      slots.map((slot) => ({
        slot: slot.slot,
        kind: slot.kind,
        label: slot.label.toString('base64'),
        versions: versions
          .filter((version) => version.slot_id === slot.id)
          .map((version) => ({ id: String(version.id), size: version.size, createdAt: iso(version.created_at) })),
      })),
    )
  })

  app.put('/api/backups/:slot', async (c) => {
    const slot = slotId.parse(c.req.param('slot'))
    const body = z.object({ kind: z.enum(['host', 'phone']), label: b64, ciphertext: b64 }).parse(await c.req.json())
    const ciphertext = bytes(body.ciphertext)
    if (ciphertext.length > ACCOUNT_LIMITS.backupBytes)
      throw new Refusal(413, `A backup is at most ${ACCOUNT_LIMITS.backupBytes / 1024} KB.`)
    const [row] = await q<{ id: string; uploaded_at: Date | null }>(
      `insert into backup_slot (id, user_id, slot, kind, label) values ($1, $2, $3, $4, $5)
       on conflict (user_id, slot) do update set label = excluded.label returning id, uploaded_at`,
      [randomUUID(), me(c).userId, slot, body.kind, bytes(body.label)],
    )
    if (row!.uploaded_at && now() - row!.uploaded_at.getTime() < ACCOUNT_LIMITS.uploadEveryMs)
      throw new Refusal(429, 'This slot was backed up less than a minute ago.')
    const [version] = await q<{ id: string }>(
      'insert into backup_version (slot_id, ciphertext, size) values ($1, $2, $3) returning id',
      [row!.id, ciphertext, ciphertext.length],
    )
    await q('update backup_slot set uploaded_at = $2 where id = $1', [row!.id, new Date(now())])
    await q(
      `delete from backup_version where slot_id = $1 and id not in
       (select id from backup_version where slot_id = $1 order by created_at desc, id desc limit $2)`,
      [row!.id, ACCOUNT_LIMITS.versions],
    )
    return c.json({ id: String(version!.id) })
  })

  app.get('/api/backups/:slot/:version', async (c) => {
    const slot = slotId.parse(c.req.param('slot'))
    const version = z
      .string()
      .regex(/^\d{1,18}$/)
      .parse(c.req.param('version'))
    const [row] = await q<{ ciphertext: Buffer }>(
      'select v.ciphertext from backup_version v join backup_slot s on s.id = v.slot_id where s.user_id = $1 and s.slot = $2 and v.id = $3',
      [me(c).userId, slot, version],
    )
    if (!row) throw new Refusal(404, 'That backup is gone.')
    return c.json({ ciphertext: row.ciphertext.toString('base64') })
  })

  app.delete('/api/backups/:slot', async (c) => {
    await q('delete from backup_slot where user_id = $1 and slot = $2', [
      me(c).userId,
      slotId.parse(c.req.param('slot')),
    ])
    return c.json({ deleted: true })
  })

  // ---- The backup key sealed under the recovery code ----

  app.put('/api/recovery', async (c) => {
    const { sealed } = z.object({ sealed: b64 }).parse(await c.req.json())
    await q(
      `insert into recovery_key (user_id, sealed) values ($1, $2)
       on conflict (user_id) do update set sealed = excluded.sealed, updated_at = now()`,
      [me(c).userId, bytes(sealed)],
    )
    return c.json({ saved: true })
  })

  app.get('/api/recovery', async (c) => {
    const [row] = await q<{ sealed: Buffer }>('select sealed from recovery_key where user_id = $1', [me(c).userId])
    return c.json({ sealed: row ? row.sealed.toString('base64') : null })
  })

  // ---- Key requests: a new device asks a device it trusts for the backup key ----

  const expires = () => new Date(now() + ACCOUNT_LIMITS.requestMs)
  const live = 'expires_at > now()'
  // Expired requests and relayed messages are deleted on every new one, so nothing waits past ten minutes.
  const sweep = () =>
    Promise.all([
      q('delete from key_request where expires_at <= now()'),
      q('delete from relay_message where expires_at <= now()'),
    ])

  app.post('/api/key-requests', async (c) => {
    const body = z.object({ name: z.string().trim().min(1).max(60), commit: hex64 }).parse(await c.req.json())
    await sweep()
    const id = randomUUID()
    await q(
      'insert into key_request (id, user_id, session_id, name, commit_hash, expires_at) values ($1, $2, $3, $4, $5, $6)',
      [id, me(c).userId, me(c).sessionId, body.name, body.commit, expires()],
    )
    return c.json({ id, expiresAt: expires().getTime() })
  })

  const requestInfo = (row: Record<string, unknown>) => ({
    id: row.id,
    name: row.name,
    commit: row.commit_hash,
    requesterKey: row.requester_key ?? null,
    approverKey: row.approver_key ?? null,
    envelope: row.envelope ? (row.envelope as Buffer).toString('base64') : null,
    createdAt: iso(row.created_at as Date),
    expiresAt: iso(row.expires_at as Date),
  })

  /** Requests from the person's other devices, for a device that holds the key to answer. */
  app.get('/api/key-requests', async (c) => {
    const rows = await q(
      `select * from key_request where user_id = $1 and session_id <> $2 and ${live} order by created_at`,
      [me(c).userId, me(c).sessionId],
    )
    return c.json(rows.map(requestInfo))
  })

  app.get('/api/key-requests/:id', async (c) => {
    const [row] = await q(`select * from key_request where id = $1 and user_id = $2 and ${live}`, [
      uuid.parse(c.req.param('id')),
      me(c).userId,
    ])
    if (!row) throw new Refusal(404, 'This request expired. Ask again from the new device.')
    // The requester reads the sealed key once; then the request is gone.
    if (row.envelope && row.session_id === me(c).sessionId) await q('delete from key_request where id = $1', [row.id])
    return c.json(requestInfo(row))
  })

  app.post('/api/key-requests/:id/offer', async (c) => {
    const { approverKey } = z.object({ approverKey: hex64 }).parse(await c.req.json())
    const rows = await q(
      `update key_request set approver_key = $3 where id = $1 and user_id = $2 and session_id <> $4 and approver_key is null and ${live} returning id`,
      [uuid.parse(c.req.param('id')), me(c).userId, approverKey, me(c).sessionId],
    )
    if (!rows.length) throw new Refusal(409, 'Another device is answering this request.')
    return c.json({ ok: true })
  })

  app.post('/api/key-requests/:id/reveal', async (c) => {
    const { requesterKey } = z.object({ requesterKey: hex64 }).parse(await c.req.json())
    const rows = await q(
      `update key_request set requester_key = $3 where id = $1 and user_id = $2 and session_id = $4 and approver_key is not null and requester_key is null and ${live} returning id`,
      [uuid.parse(c.req.param('id')), me(c).userId, requesterKey, me(c).sessionId],
    )
    if (!rows.length) throw new Refusal(409, 'This request is not waiting for that.')
    return c.json({ ok: true })
  })

  app.post('/api/key-requests/:id/approve', async (c) => {
    const { envelope } = z.object({ envelope: b64 }).parse(await c.req.json())
    const rows = await q(
      `update key_request set envelope = $3 where id = $1 and user_id = $2 and session_id <> $4 and requester_key is not null and envelope is null and ${live} returning id`,
      [uuid.parse(c.req.param('id')), me(c).userId, bytes(envelope), me(c).sessionId],
    )
    if (!rows.length) throw new Refusal(409, 'This request is not waiting for approval.')
    return c.json({ ok: true })
  })

  app.delete('/api/key-requests/:id', async (c) => {
    await q('delete from key_request where id = $1 and user_id = $2', [uuid.parse(c.req.param('id')), me(c).userId])
    return c.json({ deleted: true })
  })

  // ---- Your hosts ----

  app.get('/api/hosts', async (c) => {
    const rows = await q<{ id: string; name: string; host_key: string; last_seen: Date }>(
      'select id, name, host_key, last_seen from listed_host where user_id = $1 order by name',
      [me(c).userId],
    )
    return c.json(
      rows.map((row) => ({ id: row.id, name: row.name, hostKey: row.host_key, lastSeen: iso(row.last_seen) })),
    )
  })

  /** List in my account: a host names itself by its public key; listing again updates the name and last seen. */
  app.put('/api/hosts', async (c) => {
    const body = z
      .object({ name: z.string().trim().min(1).max(80), hostKey: z.string().min(16).max(200) })
      .parse(await c.req.json())
    const [row] = await q<{ id: string }>(
      `insert into listed_host (id, user_id, host_key, name) values ($1, $2, $3, $4)
       on conflict (user_id, host_key) do update set name = excluded.name, last_seen = now() returning id`,
      [randomUUID(), me(c).userId, body.hostKey, body.name],
    )
    return c.json({ id: row!.id })
  })

  app.delete('/api/hosts/:id', async (c) => {
    await q('delete from listed_host where id = $1 and user_id = $2', [uuid.parse(c.req.param('id')), me(c).userId])
    return c.json({ deleted: true })
  })

  const ownHost = async (c: Context<Env>) => {
    const [host] = await q<{ id: string }>('select id from listed_host where id = $1 and user_id = $2', [
      uuid.parse(c.req.param('id')),
      me(c).userId,
    ])
    if (!host) throw new Refusal(404, 'That host is not listed in this account.')
    return host.id
  }

  /** A device's pairing message to a listed host; only the same account's devices can reach it. */
  app.post('/api/hosts/:id/relay', async (c) => {
    const hostId = await ownHost(c)
    const body = z
      .object({ path: z.enum(['/pair/request', '/pair/reveal', '/pair/wait']), body: z.unknown() })
      .parse(await c.req.json())
    const text = JSON.stringify(body.body ?? null)
    if (text.length > 4096) throw new Refusal(413, 'That message is too large.')
    await sweep()
    if (body.path === '/pair/request') {
      const [waiting] = await q<{ count: string }>(
        `select count(distinct session_id) as count from relay_message where host_id = $1 and path = '/pair/request' and ${live}`,
        [hostId],
      )
      if (Number(waiting!.count) >= ACCOUNT_LIMITS.waitingPerHost)
        throw new Refusal(429, 'This host has too many requests waiting.')
      const [recent] = await q(
        `select 1 from relay_message where session_id = $1 and path = '/pair/request' and created_at > $2`,
        [me(c).sessionId, new Date(now() - ACCOUNT_LIMITS.requestEveryMs)],
      )
      if (recent) throw new Refusal(429, 'Wait a minute before asking again.')
    }
    const id = randomUUID()
    await q(
      'insert into relay_message (id, host_id, session_id, path, body, created_at, expires_at) values ($1, $2, $3, $4, $5, $6, $7)',
      [id, hostId, me(c).sessionId, body.path, text, new Date(now()), expires()],
    )
    return c.json({ id })
  })

  /** The device reads the host's answer once it is there; then the message is gone. */
  app.get('/api/relay/:id', async (c) => {
    const [row] = await q<{ reply: string | null }>(
      `select reply from relay_message where id = $1 and session_id = $2 and ${live}`,
      [uuid.parse(c.req.param('id')), me(c).sessionId],
    )
    if (!row) throw new Refusal(404, 'The host did not answer in time.')
    if (row.reply === null) return c.json({ waiting: true })
    await q('delete from relay_message where id = $1', [c.req.param('id')])
    return c.json({ waiting: false, reply: JSON.parse(row.reply) as unknown })
  })

  /** A listed host's waiting messages; checking also marks it seen. */
  app.get('/api/hosts/:id/messages', async (c) => {
    const hostId = await ownHost(c)
    await q('update listed_host set last_seen = now() where id = $1', [hostId])
    const rows = await q<{ id: string; path: string; body: string; session_id: string }>(
      `select id, path, body, session_id from relay_message where host_id = $1 and reply is null and ${live} order by created_at limit 20`,
      [hostId],
    )
    // `from` names the asking device without revealing its session: one device's messages share it.
    return c.json(
      rows.map((row) => ({
        id: row.id,
        path: row.path,
        body: JSON.parse(row.body) as unknown,
        from: createHash('sha256').update(`relay:${hostId}:${row.session_id}`).digest('hex').slice(0, 32),
      })),
    )
  })

  app.post('/api/hosts/:id/messages/:message', async (c) => {
    const hostId = await ownHost(c)
    const { reply } = z.object({ reply: z.unknown() }).parse(await c.req.json())
    const text = JSON.stringify(reply ?? null)
    if (text.length > 16_384) throw new Refusal(413, 'That answer is too large.')
    await q(`update relay_message set reply = $3 where id = $1 and host_id = $2 and reply is null and ${live}`, [
      uuid.parse(c.req.param('message')),
      hostId,
      text,
    ])
    return c.json({ ok: true })
  })

  return app
}

export class Refusal extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 409 | 413 | 429,
    message: string,
  ) {
    super(message)
  }
}
