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

it('reads an artifact as an App unless it says otherwise', () => {
  const db = openDb(profile())
  db.exec("INSERT INTO artifacts (id, data, current_version, created_at, changed_at) VALUES ('a', '{}', 1, 0, 0)")
  expect(db.prepare("SELECT kind FROM artifacts WHERE id = 'a'").get()).toEqual({ kind: 'app' })
  db.close()
})
