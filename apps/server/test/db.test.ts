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
