import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { openDb } from '../src/db'
import { Workspace } from '../src/workspace/workspace'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function repo(path: string) {
  mkdirSync(path, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: path })
}

it('finds repositories cloned into a project folder and lets them join it', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-nested-')))
  dirs.push(dir)
  const root = join(dir, 'albea-hr')
  mkdirSync(root)
  writeFileSync(join(root, 'AGENTS.md'), '# notes\n')
  const workspace = new Workspace(openDb(':memory:'), join(dir, 'worktrees'))
  const { project } = await workspace.addProjectFromFolder(root)
  expect(workspace.unregisteredChildRepositories(project.id)).toEqual([])

  repo(join(root, 'backend'))
  repo(join(root, 'frontend'))
  mkdirSync(join(root, 'docs'))
  expect(workspace.unregisteredChildRepositories(project.id)).toEqual([join(root, 'backend'), join(root, 'frontend')])
  expect(workspace.projectHolding(join(root, 'backend'))?.id).toBe(project.id)

  await workspace.addRepository(project.id, join(root, 'backend'))
  expect(workspace.unregisteredChildRepositories(project.id)).toEqual([join(root, 'frontend')])
})

it('leaves clones inside a repository project alone', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-nested-')))
  dirs.push(dir)
  const root = join(dir, 'app')
  repo(root)
  const workspace = new Workspace(openDb(':memory:'), join(dir, 'worktrees'))
  const { project } = await workspace.addProjectFromFolder(root)
  repo(join(root, 'vendor-lib'))
  expect(workspace.unregisteredChildRepositories(project.id)).toEqual([])
  expect(workspace.projectHolding(join(root, 'vendor-lib'))).toBeUndefined()
})
