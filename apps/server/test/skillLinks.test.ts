import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { reconcileSkillLinks } from '../src/memory/skillLinks'

let base: string, root: string, source: string, cwd: string, dir: string
const warn = vi.fn()
const skill = (name: string) => {
  mkdirSync(join(source, name), { recursive: true })
  writeFileSync(join(source, name, 'SKILL.md'), `---\nname: ${name}\n---\n`)
}
const reconcile = () => reconcileSkillLinks({ dir, cwd }, source, root, warn)
const names = () => (existsSync(dir) ? readdirSync(dir).sort() : [])
const git = (...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' })

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'ramu-skill-links-'))
  root = join(base, 'export')
  source = join(root, 'global', 'skills')
  cwd = join(base, 'project')
  dir = join(cwd, '.cursor', 'skills')
  mkdirSync(source, { recursive: true })
  mkdirSync(cwd)
  warn.mockClear()
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

it('creates the missing folder and one link per exported skill, pointing at the export', () => {
  skill('ramu-alpha')
  skill('ramu-beta')
  expect(reconcile().created).toHaveLength(2)
  expect(names()).toEqual(['ramu-alpha', 'ramu-beta'])
  expect(lstatSync(join(dir, 'ramu-alpha')).isSymbolicLink()).toBe(true)
  expect(readlinkSync(join(dir, 'ramu-alpha'))).toBe(join(source, 'ramu-alpha'))
  expect(readFileSync(join(dir, 'ramu-beta', 'SKILL.md'), 'utf8')).toContain('ramu-beta')
})

it('creates nothing, not even the folder, when there are no skills', () => {
  expect(reconcile()).toEqual({ created: [], removed: [], skipped: [] })
  expect(existsSync(join(cwd, '.cursor'))).toBe(false)
})

it('is idempotent', () => {
  skill('ramu-alpha')
  reconcile()
  expect(reconcile()).toEqual({ created: [], removed: [], skipped: [] })
  expect(names()).toEqual(['ramu-alpha'])
})

it('removes links for skills that left the export, leaves the skill files alone, and ignores the user entries', () => {
  skill('ramu-alpha')
  skill('ramu-beta')
  reconcile()
  mkdirSync(join(dir, 'mine'))
  writeFileSync(join(dir, 'mine', 'SKILL.md'), 'mine')
  rmSync(join(source, 'ramu-beta'), { recursive: true })
  expect(reconcile().removed).toEqual([join(dir, 'ramu-beta')])
  expect(names()).toEqual(['mine', 'ramu-alpha'])
  rmSync(join(source, 'ramu-alpha'), { recursive: true })
  reconcile()
  expect(names()).toEqual(['mine'])
  expect(readFileSync(join(dir, 'mine', 'SKILL.md'), 'utf8')).toBe('mine')
})

it('repoints a Ramu link that targets another export of the same root', () => {
  skill('ramu-alpha')
  const other = join(root, 'project-1', 'skills', 'ramu-alpha')
  mkdirSync(other, { recursive: true })
  mkdirSync(dir, { recursive: true })
  symlinkSync(other, join(dir, 'ramu-alpha'), 'dir')
  reconcile()
  expect(readlinkSync(join(dir, 'ramu-alpha'))).toBe(join(source, 'ramu-alpha'))
  expect(existsSync(other)).toBe(true)
})

it('never overwrites or removes a real file or folder, or a link pointing outside the export root', () => {
  skill('ramu-real')
  skill('ramu-file')
  skill('ramu-foreign')
  mkdirSync(join(dir), { recursive: true })
  mkdirSync(join(dir, 'ramu-real'))
  writeFileSync(join(dir, 'ramu-real', 'SKILL.md'), 'mine')
  writeFileSync(join(dir, 'ramu-file'), 'mine')
  const elsewhere = join(base, 'elsewhere')
  mkdirSync(elsewhere)
  symlinkSync(elsewhere, join(dir, 'ramu-foreign'), 'dir')
  // Not wanted any more, but not ours either.
  symlinkSync(elsewhere, join(dir, 'ramu-old'), 'dir')
  const result = reconcile()
  expect(result.created).toEqual([])
  expect(result.removed).toEqual([])
  expect(result.skipped.sort()).toEqual(['ramu-file', 'ramu-foreign', 'ramu-old', 'ramu-real'].map((n) => join(dir, n)))
  expect(warn).toHaveBeenCalledTimes(4)
  expect(readFileSync(join(dir, 'ramu-real', 'SKILL.md'), 'utf8')).toBe('mine')
  expect(readFileSync(join(dir, 'ramu-file'), 'utf8')).toBe('mine')
  expect(readlinkSync(join(dir, 'ramu-foreign'))).toBe(elsewhere)
  expect(readlinkSync(join(dir, 'ramu-old'))).toBe(elsewhere)
  expect(existsSync(elsewhere)).toBe(true)
})

it('only handles names that start with ramu-', () => {
  skill('ramu-alpha')
  skill('other')
  reconcile()
  expect(names()).toEqual(['ramu-alpha'])
  mkdirSync(join(root, 'global', 'skills', 'note'))
  symlinkSync(join(source, 'note'), join(dir, 'note'), 'dir')
  reconcile()
  expect(names()).toEqual(['note', 'ramu-alpha'])
})

it('removes a stale link without touching what it pointed at', () => {
  const other = join(root, 'project-1', 'skills', 'ramu-gone')
  mkdirSync(other, { recursive: true })
  writeFileSync(join(other, 'SKILL.md'), 'kept')
  mkdirSync(dir, { recursive: true })
  symlinkSync(other, join(dir, 'ramu-gone'), 'dir')
  expect(reconcile().removed).toEqual([join(dir, 'ramu-gone')])
  expect(names()).toEqual([])
  expect(readFileSync(join(other, 'SKILL.md'), 'utf8')).toBe('kept')
})

it('does not write through a skills folder that is itself a link', () => {
  skill('ramu-alpha')
  const shared = join(base, 'shared-skills')
  mkdirSync(shared)
  mkdirSync(join(cwd, '.cursor'))
  symlinkSync(shared, dir, 'dir')
  expect(reconcile().skipped).toEqual([dir])
  expect(readdirSync(shared)).toEqual([])
})

it('excludes the links through .git/info/exclude in a repository, once, without touching tracked files', () => {
  git('init', '-q')
  writeFileSync(join(cwd, 'README.md'), 'x')
  git('add', 'README.md')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init')
  skill('ramu-alpha')
  reconcile()
  skill('ramu-beta')
  reconcile()
  const exclude = readFileSync(join(cwd, '.git', 'info', 'exclude'), 'utf8')
  expect(exclude.split('\n').filter((line) => line === '/.cursor/skills/ramu-*')).toHaveLength(1)
  expect(existsSync(join(cwd, '.gitignore'))).toBe(false)
  expect(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })).toBe('')
})

it('anchors the exclude entry at the repository root when the thread runs in a subfolder', () => {
  git('init', '-q')
  cwd = join(cwd, 'packages', 'app')
  mkdirSync(cwd, { recursive: true })
  dir = join(cwd, '.cursor', 'skills')
  skill('ramu-alpha')
  reconcile()
  const exclude = readFileSync(join(base, 'project', '.git', 'info', 'exclude'), 'utf8')
  expect(exclude).toContain('/packages/app/.cursor/skills/ramu-*\n')
  expect(execFileSync('git', ['status', '--porcelain', '-uall'], { cwd, encoding: 'utf8' })).toBe('')
})

it('works outside a git repository', () => {
  skill('ramu-alpha')
  expect(reconcile().created).toHaveLength(1)
  expect(existsSync(join(cwd, '.git'))).toBe(false)
})
