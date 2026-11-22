import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'

let home: string, db: Db, ws: Workspace
beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-home-')))
  vi.stubEnv('HOME', home)
  db = openDb(':memory:')
  ws = new Workspace(db, join(home, '.ramu-data'))
})
afterEach(() => {
  db.close()
  vi.unstubAllEnvs()
  rmSync(home, { recursive: true, force: true })
})
const repo = async (path: string) => {
  mkdirSync(path, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: path })
  await ws.addProjectFromFolder(path)
}

it('never proposes the home folder: ~/Projects, made only for a caller about to use it', () => {
  expect(ws.newProjectParent()).toBe(join(home, 'Projects'))
  expect(() => realpathSync(join(home, 'Projects'))).toThrow()
  ws.newProjectParent(true)
  expect(realpathSync(join(home, 'Projects'))).toBe(join(home, 'Projects'))
})

it('prefers a usual projects folder that exists, then the folder holding most repositories, then the person’s choice', async () => {
  mkdirSync(join(home, 'Developer'))
  expect(ws.newProjectParent()).toBe(join(home, 'Developer'))
  await repo(join(home, 'one-off', 'site'))
  await repo(join(home, 'work', 'api'))
  await repo(join(home, 'work', 'web'))
  // A repository sitting directly in the home folder does not make home the place for projects.
  await repo(join(home, 'dotfiles'))
  expect(ws.newProjectParent()).toBe(join(home, 'work'))
  const picked = join(home, 'clients')
  mkdirSync(picked)
  ws.rememberProjectParent(picked)
  expect(ws.newProjectParent()).toBe(picked)
  // A chosen folder that is gone no longer counts.
  rmSync(picked, { recursive: true })
  expect(ws.chosenProjectParent()).toBeNull()
  expect(ws.newProjectParent()).toBe(join(home, 'work'))
})
