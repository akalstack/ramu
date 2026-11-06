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

it('refuses a profile from another schema without changing it', () => {
  const path = profile()
  const other = new DatabaseSync(path)
  other.exec('CREATE TABLE kept (id INTEGER); PRAGMA user_version = 3;')
  other.close()
  expect(() => openDb(path)).toThrow(/schema version 3/)
  const again = new DatabaseSync(path)
  expect(again.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 })
  expect(again.prepare("SELECT name FROM sqlite_master WHERE name = 'kept'").get()).toBeDefined()
  again.close()
})

it('adds the artifact kind to a profile kept before it, reading existing pages as apps', () => {
  const path = profile()
  openDb(path).close()
  const earlier = new DatabaseSync(path)
  earlier.exec('ALTER TABLE interactive_pages DROP COLUMN kind')
  earlier.exec(
    "INSERT INTO interactive_pages (id, data, current_version, pinned, created_at, changed_at) VALUES ('kept', '{}', 1, 0, 0, 0)",
  )
  earlier.close()
  const reopened = openDb(path)
  expect(reopened.prepare("SELECT kind FROM interactive_pages WHERE id = 'kept'").get()).toEqual({ kind: 'app' })
  reopened.close()
  // Opening again finds the column and leaves it alone.
  const again = openDb(path)
  expect(again.prepare('SELECT COUNT(*) AS n FROM interactive_pages').get()).toEqual({ n: 1 })
  again.close()
})
