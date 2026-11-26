import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { openDb } from '../src/db'

const dirs: string[] = []
const profile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-db-'))
  dirs.push(dir)
  return join(dir, 'ramu.db')
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

it('creates the schema once and reopens it with its data', () => {
  const path = profile()
  const first = openDb(path)
  expect(first.prepare("SELECT id FROM projects WHERE id = 'no-project'").get()).toBeDefined()
  first.exec("INSERT INTO projects (id, name, created_at) VALUES ('p', 'Project', 0)")
  first.close()
  const second = openDb(path)
  expect(second.prepare('SELECT COUNT(*) AS n FROM projects').get()).toEqual({ n: 2 })
  expect(second.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
  second.close()
})

const versionOf = (path: string) => {
  const db = new DatabaseSync(path)
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  db.close()
  return user_version
}

it('upgrades an older profile in place, running each later migration once and in order', () => {
  const path = profile()
  openDb(path, []).close()
  const released = versionOf(path)
  const db = openDb(path, [])
  db.exec("INSERT INTO projects (id, name, created_at) VALUES ('p', 'Project', 0)")
  db.close()
  const ran: string[] = []
  const migrations = [
    (db: DatabaseSync) => {
      ran.push('first')
      db.exec("ALTER TABLE projects ADD COLUMN colour TEXT NOT NULL DEFAULT 'violet'")
    },
    (db: DatabaseSync) => {
      ran.push('second')
      db.exec("UPDATE projects SET colour = 'blue' WHERE id = 'p'")
    },
  ]
  const upgraded = openDb(path, migrations)
  expect(ran).toEqual(['first', 'second'])
  expect(upgraded.prepare("SELECT name, colour FROM projects WHERE id = 'p'").get()).toEqual({
    name: 'Project',
    colour: 'blue',
  })
  upgraded.close()
  expect(versionOf(path)).toBe(released + 2)
  openDb(path, migrations).close()
  expect(ran).toEqual(['first', 'second'])
})

it('leaves a profile as it was when a migration fails', () => {
  const path = profile()
  openDb(path).close()
  const released = versionOf(path)
  const failing = [
    (db: DatabaseSync) => db.exec('CREATE TABLE half_done (id INTEGER)'),
    () => {
      throw new Error('migration failed')
    },
  ]
  expect(() => openDb(path, failing)).toThrow('migration failed')
  expect(versionOf(path)).toBe(released)
  const db = new DatabaseSync(path)
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half_done'").get()).toBeUndefined()
  db.close()
})

it('refuses a profile written by a newer Ramu without changing it', () => {
  const path = profile()
  openDb(path).close()
  const newer = versionOf(path) + 1
  const db = new DatabaseSync(path)
  db.exec(`CREATE TABLE kept (id INTEGER); PRAGMA user_version = ${newer};`)
  db.close()
  expect(() => openDb(path)).toThrow(/newer Ramu/)
  expect(versionOf(path)).toBe(newer)
  const again = new DatabaseSync(path)
  expect(again.prepare("SELECT name FROM sqlite_master WHERE name = 'kept'").get()).toBeDefined()
  again.close()
})

it('refuses a profile from before the first public release without changing it', () => {
  const path = profile()
  const other = new DatabaseSync(path)
  other.exec('CREATE TABLE kept (id INTEGER); PRAGMA user_version = 3;')
  other.close()
  expect(() => openDb(path)).toThrow(/before 0\.1\.0/)
  expect(versionOf(path)).toBe(3)
})

it('lists reviews newest first without sorting their data into a temporary file', () => {
  const path = profile()
  openDb(path, []).close()
  // A profile from before the index: the migration adds it.
  const old = new DatabaseSync(path)
  old.exec('DROP INDEX reviews_by_time')
  old.close()
  // A profile that had the index added by hand before upgrading upgrades too.
  const manual = profile()
  openDb(manual, []).close()
  openDb(manual).close()
  const db = openDb(path)
  for (const query of [
    'SELECT data FROM change_reviews ORDER BY created_at DESC, rowid DESC',
    "SELECT data FROM change_reviews WHERE state='ready' ORDER BY created_at DESC, rowid DESC LIMIT 200",
  ]) {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${query}`).all() as { detail: string }[]
    expect(plan.map((step) => step.detail).join('\n')).not.toMatch(/TEMP B-TREE/)
  }
  db.close()
})

it('reads an artifact as an App unless it says otherwise', () => {
  const db = openDb(profile())
  db.exec("INSERT INTO artifacts (id, data, current_version, created_at, changed_at) VALUES ('a', '{}', 1, 0, 0)")
  expect(db.prepare("SELECT kind FROM artifacts WHERE id = 'a'").get()).toEqual({ kind: 'app' })
  db.close()
})
