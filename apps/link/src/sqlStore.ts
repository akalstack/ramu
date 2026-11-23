// The Store over a Durable Object's SQLite. One object holds every slot, so allocation needs no cross-object locking.
import type { Slot, Store, Waiting } from './pool'

// Slots and the waitlist are keyed by account and host, since one account keeps a link for several hosts.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS host_slots (
    user_id TEXT NOT NULL, host_id TEXT NOT NULL, host_name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    tunnel_id TEXT, dns_record_id TEXT, port INTEGER NOT NULL, https INTEGER NOT NULL, created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL, seen_reported_at INTEGER NOT NULL, last_online_at INTEGER NOT NULL,
    warned_at INTEGER, suspended_until INTEGER, bytes INTEGER NOT NULL, counted_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, host_id))`,
  `CREATE TABLE IF NOT EXISTS host_waitlist (
    user_id TEXT NOT NULL, host_id TEXT NOT NULL, host_name TEXT NOT NULL, since INTEGER NOT NULL,
    promoted_at INTEGER, PRIMARY KEY (user_id, host_id))`,
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

/** Moves slots and the waitlist from the one-host-per-account tables, once, then drops those. */
function migrate(sql: SqlStorage) {
  const has = (name: string) =>
    sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", name).toArray()
      .length > 0
  if (has('slots')) {
    sql.exec('INSERT OR IGNORE INTO host_slots SELECT * FROM slots')
    sql.exec('DROP TABLE slots')
  }
  if (has('waitlist')) {
    sql.exec('INSERT OR IGNORE INTO host_waitlist SELECT * FROM waitlist')
    sql.exec('DROP TABLE waitlist')
  }
}

export function sqlStore(sql: SqlStorage): Store {
  for (const statement of SCHEMA) sql.exec(statement)
  migrate(sql)
  return {
    slotOf(userId, hostId) {
      const row = sql
        .exec<SlotRow>('SELECT * FROM host_slots WHERE user_id = ? AND host_id = ?', userId, hostId)
        .toArray()[0]
      return row ? slotOf(row) : null
    },
    slotsOf(userId) {
      return sql
        .exec<SlotRow>('SELECT * FROM host_slots WHERE user_id = ? ORDER BY created_at', userId)
        .toArray()
        .map(slotOf)
    },
    slots() {
      return sql.exec<SlotRow>('SELECT * FROM host_slots').toArray().map(slotOf)
    },
    putSlot(slot) {
      sql.exec(
        `INSERT OR REPLACE INTO host_slots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    deleteSlot(userId, hostId) {
      sql.exec('DELETE FROM host_slots WHERE user_id = ? AND host_id = ?', userId, hostId)
    },
    waiting() {
      return sql
        .exec<WaitingRow>('SELECT * FROM host_waitlist ORDER BY since, user_id, host_id')
        .toArray()
        .map(waitingOf)
    },
    putWaiting(entry) {
      sql.exec(
        'INSERT OR REPLACE INTO host_waitlist VALUES (?, ?, ?, ?, ?)',
        entry.userId,
        entry.hostId,
        entry.hostName,
        entry.since,
        entry.promotedAt,
      )
    },
    deleteWaiting(userId, hostId) {
      sql.exec('DELETE FROM host_waitlist WHERE user_id = ? AND host_id = ?', userId, hostId)
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
