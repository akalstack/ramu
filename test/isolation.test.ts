import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyIsolation, collectPatch, createIsolation, removeIsolation } from '../src/main/isolation'

let tmp: string
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
const repo = (dir: string, files: Record<string, string>) => {
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main'); for (const [k, v] of [['user.email', 'a@b.c'], ['user.name', 'X'], ['commit.gpgsign', 'false']]) git(dir, 'config', k!, v!)
  for (const [name, text] of Object.entries(files)) { mkdirSync(join(dir, name, '..'), { recursive: true }); writeFileSync(join(dir, name), text) }
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'init')
  return realpathSync(dir)
}
beforeEach(() => { tmp = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-iso-'))) })
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('sub-agent isolation', () => {
  it('copies a single repository, starting from its current files, and brings the changes back', async () => {
    const source = repo(join(tmp, 'app'), { 'a.txt': 'one\n', 'b.txt': 'keep\n' })
    writeFileSync(join(source, 'a.txt'), 'one\nuncommitted\n')
    const iso = (await createIsolation({ cwd: source, covers: [source], root: join(tmp, 'iso') }))!
    expect(iso.cwd).toBe(join(tmp, 'iso'))
    expect(readFileSync(join(iso.cwd, 'a.txt'), 'utf8')).toBe('one\nuncommitted\n')
    // The sub-agent edits, adds and removes; the checkout is untouched until it is done.
    writeFileSync(join(iso.cwd, 'a.txt'), 'one\nuncommitted\nby agent\n'); writeFileSync(join(iso.cwd, 'new.txt'), 'new\n'); rmSync(join(iso.cwd, 'b.txt'))
    expect(readFileSync(join(source, 'a.txt'), 'utf8')).toBe('one\nuncommitted\n')
    expect((await collectPatch(iso.repos[0]!)).files.sort()).toEqual(['a.txt', 'b.txt', 'new.txt'])
    const outcome = await applyIsolation(iso)
    expect(outcome).toEqual({ applied: 3, failed: [], kept: [] })
    expect(readFileSync(join(source, 'a.txt'), 'utf8')).toBe('one\nuncommitted\nby agent\n')
    expect(readFileSync(join(source, 'new.txt'), 'utf8')).toBe('new\n')
    expect(existsSync(join(source, 'b.txt'))).toBe(false)
    expect(existsSync(iso.root)).toBe(false)
    expect(git(source, 'worktree', 'list').split('\n')).toHaveLength(1)
    // Nothing was committed or staged on the user's behalf.
    expect(git(source, 'log', '--oneline').split('\n')).toHaveLength(1)
    expect(git(source, 'diff', '--cached', '--name-only')).toBe('')
  })

  it('lays out several repositories under a workspace folder like the original, and puts outside repos beside it', async () => {
    const workspace = join(tmp, 'shop'); mkdirSync(workspace)
    const web = repo(join(workspace, 'web'), { 'w.txt': 'w\n' }), api = repo(join(workspace, 'api'), { 'src/s.txt': 's\n' })
    const lib = repo(join(tmp, 'lib'), { 'l.txt': 'l\n' })
    const iso = (await createIsolation({ cwd: workspace, covers: [web, api, lib], root: join(tmp, 'iso') }))!
    expect(iso.covers).toEqual([join(tmp, 'iso', 'web'), join(tmp, 'iso', 'api'), join(iso.root, '__extra', '2-lib')])
    expect(iso.additionalDirs).toEqual([join(iso.root, '__extra', '2-lib')])
    writeFileSync(join(iso.cwd, 'api', 'src', 's.txt'), 's2\n'); writeFileSync(join(iso.root, '__extra', '2-lib', 'l.txt'), 'l2\n')
    expect(await applyIsolation(iso)).toMatchObject({ applied: 2, failed: [] })
    expect(readFileSync(join(api, 'src/s.txt'), 'utf8')).toBe('s2\n')
    expect(readFileSync(join(lib, 'l.txt'), 'utf8')).toBe('l2\n')
    expect(readFileSync(join(web, 'w.txt'), 'utf8')).toBe('w\n')
  })

  it('keeps a worktree whose changes conflict with the checkout and applies the rest', async () => {
    const workspace = join(tmp, 'shop'); mkdirSync(workspace)
    const web = repo(join(workspace, 'web'), { 'w.txt': 'line\n' }), api = repo(join(workspace, 'api'), { 's.txt': 's\n' })
    const iso = (await createIsolation({ cwd: workspace, covers: [web, api], root: join(tmp, 'iso') }))!
    writeFileSync(join(iso.cwd, 'web', 'w.txt'), 'agent\n'); writeFileSync(join(iso.cwd, 'api', 's.txt'), 's2\n')
    writeFileSync(join(web, 'w.txt'), 'someone else\n')
    const outcome = await applyIsolation(iso)
    expect(outcome.applied).toBe(1)
    expect(outcome.failed).toHaveLength(1)
    expect(outcome.failed[0]!.repo).toBe('web')
    expect(outcome.kept).toEqual([join(tmp, 'iso', 'web')])
    expect(readFileSync(join(web, 'w.txt'), 'utf8')).toBe('someone else\n')
    expect(readFileSync(join(iso.cwd, 'web', 'w.txt'), 'utf8')).toBe('agent\n')
    expect(readFileSync(join(api, 's.txt'), 'utf8')).toBe('s2\n')
    await removeIsolation(iso)
    expect(existsSync(iso.root)).toBe(false)
  })

  it('has nothing to isolate without a git repository, and says so for an empty one', async () => {
    const folder = join(tmp, 'plain'); mkdirSync(folder)
    expect(await createIsolation({ cwd: folder, covers: [folder], root: join(tmp, 'iso') })).toBeNull()
    const empty = join(tmp, 'empty'); mkdirSync(empty); git(empty, 'init', '-q')
    await expect(createIsolation({ cwd: empty, covers: [empty], root: join(tmp, 'iso2') })).rejects.toThrow(/no commits/)
    expect(existsSync(join(tmp, 'iso2'))).toBe(false)
  })
})
