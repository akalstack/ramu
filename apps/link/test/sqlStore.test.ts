import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { newSlot } from '../src/pool'
import { sqlStore } from '../src/sqlStore'

/** The Durable Object's SQL API over Node's SQLite, enough for the store. */
function storage(db: DatabaseSync): SqlStorage {
  return {
    exec<T>(query: string, ...bindings: SqlValue[]) {
      const statement = db.prepare(query)
      const rows = /^\s*(select|pragma)/i.test(query) ? statement.all(...bindings) : (statement.run(...bindings), [])
      return { toArray: () => rows as T[] }
    },
  }
}

it('moves one-host-per-account slots and the waitlist to tables keyed by account and host, once', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE slots (
    user_id TEXT PRIMARY KEY, host_id TEXT NOT NULL, host_name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    tunnel_id TEXT, dns_record_id TEXT, port INTEGER NOT NULL, https INTEGER NOT NULL, created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL, seen_reported_at INTEGER NOT NULL, last_online_at INTEGER NOT NULL,
    warned_at INTEGER, suspended_until INTEGER, bytes INTEGER NOT NULL, counted_at INTEGER NOT NULL)`)
  db.exec(`CREATE TABLE waitlist (
    user_id TEXT PRIMARY KEY, host_id TEXT NOT NULL, host_name TEXT NOT NULL, since INTEGER NOT NULL, promoted_at INTEGER)`)
  db.exec(`INSERT INTO slots VALUES ('alice', 'mac', 'Mac', 's1', 't1', 'r1', 7788, 0, 1, 2, 0, 3, NULL, NULL, 5, 4)`)
  db.exec(`INSERT INTO waitlist VALUES ('bob', 'pc', 'PC', 10, NULL)`)
  const store = sqlStore(storage(db))
  expect(store.slotOf('alice', 'mac')).toMatchObject({ slug: 's1', tunnelId: 't1', dnsRecordId: 'r1', bytes: 5 })
  expect(store.waiting()).toEqual([{ userId: 'bob', hostId: 'pc', hostName: 'PC', since: 10, promotedAt: null }])
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
  expect(tables.map((table) => table.name)).not.toContain('slots')
  // A second account host now fits beside the first, and opening the store again changes nothing.
  store.putSlot(newSlot('alice', 'linux', 'Linux', 's2', 6))
  expect(
    sqlStore(storage(db))
      .slotsOf('alice')
      .map((slot) => slot.hostId),
  ).toEqual(['mac', 'linux'])
})
