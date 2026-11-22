// The Store over a Durable Object's SQLite. One object holds every slot, so allocation needs no cross-object locking.
import type { Slot, Store, Waiting } from './pool'

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS slots (
    user_id TEXT PRIMARY KEY, host_id TEXT NOT NULL, host_name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    tunnel_id TEXT, dns_record_id TEXT, port INTEGER NOT NULL, https INTEGER NOT NULL, created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL, seen_reported_at INTEGER NOT NULL, last_online_at INTEGER NOT NULL,
    warned_at INTEGER, suspended_until INTEGER, bytes INTEGER NOT NULL, counted_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS waitlist (
    user_id TEXT PRIMARY KEY, host_id TEXT NOT NULL, host_name TEXT NOT NULL, since INTEGER NOT NULL,
    promoted_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS down_since (tunnel_id TEXT PRIMARY KEY, since INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)`,
]

interface SlotRow {
  user_id: string
  host_id: string
  host_name: string
  slug: string
  tunnel_id: string | null
  dns_record_id: string | null
  port: number
  https: number
  created_at: number
  last_seen_at: number
  seen_reported_at: number
  last_online_at: number
  warned_at: number | null
  suspended_until: number | null
  bytes: number
  counted_at: number
}
interface WaitingRow {
  user_id: string
  host_id: string
  host_name: string
  since: number
  promoted_at: number | null
}

const slotOf = (row: SlotRow): Slot => ({
  userId: row.user_id,
  hostId: row.host_id,
  hostName: row.host_name,
  slug: row.slug,
  tunnelId: row.tunnel_id,
  dnsRecordId: row.dns_record_id,
  port: row.port,
  https: row.https === 1,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
  seenReportedAt: row.seen_reported_at,
  lastOnlineAt: row.last_online_at,
  warnedAt: row.warned_at,
  suspendedUntil: row.suspended_until,
  bytes: row.bytes,
  countedAt: row.counted_at,
})
const waitingOf = (row: WaitingRow): Waiting => ({
  userId: row.user_id,
  hostId: row.host_id,
  hostName: row.host_name,
  since: row.since,
  promotedAt: row.promoted_at,
})

export function sqlStore(sql: SqlStorage): Store {
  for (const statement of SCHEMA) sql.exec(statement)
  return {
    slotOf(userId) {
      const row = sql.exec<SlotRow>('SELECT * FROM slots WHERE user_id = ?', userId).toArray()[0]
      return row ? slotOf(row) : null
    },
    slots() {
      return sql.exec<SlotRow>('SELECT * FROM slots').toArray().map(slotOf)
    },
    putSlot(slot) {
      sql.exec(
        `INSERT OR REPLACE INTO slots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        slot.userId,
        slot.hostId,
        slot.hostName,
        slot.slug,
        slot.tunnelId,
        slot.dnsRecordId,
        slot.port,
        slot.https ? 1 : 0,
        slot.createdAt,
        slot.lastSeenAt,
        slot.seenReportedAt,
        slot.lastOnlineAt,
        slot.warnedAt,
        slot.suspendedUntil,
        slot.bytes,
        slot.countedAt,
      )
    },
    deleteSlot(userId) {
      sql.exec('DELETE FROM slots WHERE user_id = ?', userId)
    },
    waiting() {
      return sql.exec<WaitingRow>('SELECT * FROM waitlist ORDER BY since, user_id').toArray().map(waitingOf)
    },
    putWaiting(entry) {
      sql.exec(
        'INSERT OR REPLACE INTO waitlist VALUES (?, ?, ?, ?, ?)',
        entry.userId,
        entry.hostId,
        entry.hostName,
        entry.since,
        entry.promotedAt,
      )
    },
    deleteWaiting(userId) {
      sql.exec('DELETE FROM waitlist WHERE user_id = ?', userId)
    },
    session(hash, now) {
      sql.exec('DELETE FROM sessions WHERE expires_at <= ?', now)
      return (
        sql.exec<{ user_id: string }>('SELECT user_id FROM sessions WHERE hash = ?', hash).toArray()[0]?.user_id ?? null
      )
    },
    putSession(hash, userId, expiresAt) {
      sql.exec('INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)', hash, userId, expiresAt)
    },
    downSince(tunnelId) {
      return (
        sql.exec<{ since: number }>('SELECT since FROM down_since WHERE tunnel_id = ?', tunnelId).toArray()[0]?.since ??
        null
      )
    },
    setDownSince(tunnelId, at) {
      if (at === null) sql.exec('DELETE FROM down_since WHERE tunnel_id = ?', tunnelId)
      else sql.exec('INSERT OR REPLACE INTO down_since VALUES (?, ?)', tunnelId, at)
    },
    meta(key) {
      return sql.exec<{ value: number }>('SELECT value FROM meta WHERE key = ?', key).toArray()[0]?.value ?? null
    },
    setMeta(key, value) {
      sql.exec('INSERT OR REPLACE INTO meta VALUES (?, ?)', key, value)
    },
  }
}
