import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as git from '../src/main/git'

// A bare remote with two clones: "mine" is the checkout under test, "theirs" pushes competing commits.
let tmp: string, remote: string, mine: string, theirs: string
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
const configure = (dir: string) => { sh(dir, 'config', 'user.email', 'test@example.com'); sh(dir, 'config', 'user.name', 'Test'); sh(dir, 'config', 'commit.gpgsign', 'false') }
const commit = (dir: string, file: string, text: string, message: string) => { writeFileSync(join(dir, file), text); sh(dir, 'add', file); sh(dir, 'commit', '-q', '-m', message) }
const parents = (dir: string) => sh(dir, 'log', '-1', '--format=%P').split(' ').filter(Boolean).length

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ramu-sync-'))
  remote = join(tmp, 'remote.git'); mine = join(tmp, 'mine'); theirs = join(tmp, 'theirs')
  sh(tmp, 'init', '-q', '--bare', '-b', 'main', remote)
  sh(tmp, 'clone', '-q', remote, mine); configure(mine)
  commit(mine, 'shared.txt', 'base\n', 'Base'); sh(mine, 'push', '-q', '-u', 'origin', 'main')
  sh(tmp, 'clone', '-q', remote, theirs); configure(theirs)
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('Sync and pull modes', () => {
  it('rebase sync on diverged branches keeps history linear and pushes', async () => {
    commit(theirs, 'theirs.txt', 'theirs\n', 'Theirs'); sh(theirs, 'push', '-q')
    commit(mine, 'mine.txt', 'mine\n', 'Mine')
    await git.sync(mine, 'rebase')
    expect(parents(mine)).toBe(1)
    expect(sh(mine, 'log', '--format=%s')).toBe('Mine\nTheirs\nBase')
    expect(sh(remote, 'log', '-1', '--format=%s', 'main')).toBe('Mine')
    expect((await git.status(mine)).operation).toBeNull()
  })
  it('merge mode creates a merge commit', async () => {
    commit(theirs, 'theirs.txt', 'theirs\n', 'Theirs'); sh(theirs, 'push', '-q')
    commit(mine, 'mine.txt', 'mine\n', 'Mine')
    sh(mine, 'config', 'pull.ff', 'only') // merge mode must override a fast-forward-only config
    await git.pull(mine, 'merge')
    expect(parents(mine)).toBe(2)
  })
  it('fast-forward-only refuses diverged branches', async () => {
    commit(theirs, 'theirs.txt', 'theirs\n', 'Theirs'); sh(theirs, 'push', '-q')
    commit(mine, 'mine.txt', 'mine\n', 'Mine')
    await expect(git.pull(mine, 'ff-only')).rejects.toThrow()
    expect(sh(mine, 'log', '-1', '--format=%s')).toBe('Mine')
  })
  it('a conflicting rebase reports the operation, blocks sync, and abort restores the checkout', async () => {
    commit(theirs, 'shared.txt', 'theirs\n', 'Theirs edit'); sh(theirs, 'push', '-q')
    commit(mine, 'shared.txt', 'mine\n', 'My edit')
    const head = sh(mine, 'rev-parse', 'HEAD')
    await expect(git.sync(mine, 'rebase')).rejects.toThrow(/conflict in 1 file.*Abort the rebase. Nothing was pushed/)
    expect((await git.status(mine)).operation).toBe('rebase')
    await expect(git.sync(mine, 'rebase')).rejects.toThrow(/rebase is in progress/)
    await expect(git.continueOperation(mine)).rejects.toThrow(/Resolve and stage/)
    expect(sh(remote, 'log', '-1', '--format=%s', 'main')).toBe('Theirs edit') // nothing pushed after the failed pull
    await git.abortOperation(mine)
    expect((await git.status(mine)).operation).toBeNull()
    expect(sh(mine, 'rev-parse', 'HEAD')).toBe(head)
  })
  it('continuing a resolved rebase finishes it', async () => {
    commit(theirs, 'shared.txt', 'theirs\n', 'Theirs edit'); sh(theirs, 'push', '-q')
    commit(mine, 'shared.txt', 'mine\n', 'My edit')
    await expect(git.pull(mine, 'rebase')).rejects.toThrow()
    writeFileSync(join(mine, 'shared.txt'), 'resolved\n'); sh(mine, 'add', 'shared.txt')
    await git.continueOperation(mine)
    expect((await git.status(mine)).operation).toBeNull()
    expect(sh(mine, 'log', '--format=%s')).toBe('My edit\nTheirs edit\nBase')
  })
  it('detects a rebase in progress inside a linked worktree', async () => {
    const wt = join(tmp, 'linked worktree')
    sh(mine, 'worktree', 'add', '-q', '-b', 'feature', wt, 'main')
    commit(wt, 'shared.txt', 'feature\n', 'Feature edit')
    commit(mine, 'shared.txt', 'main\n', 'Main edit')
    await expect(git.operation(wt)).resolves.toBeNull()
    try { sh(wt, 'rebase', 'main') } catch { /* conflict expected */ }
    expect((await git.status(wt)).operation).toBe('rebase')
    expect((await git.status(mine)).operation).toBeNull()
    await git.abortOperation(wt)
    expect((await git.status(wt)).operation).toBeNull()
  })
  it('publishes a branch without an upstream', async () => {
    sh(mine, 'switch', '-q', '-c', 'topic'); commit(mine, 'topic.txt', 'topic\n', 'Topic')
    await git.sync(mine, 'rebase')
    expect(sh(remote, 'log', '-1', '--format=%s', 'topic')).toBe('Topic')
  })
  it('refuses to pull over working changes and points at stash', async () => {
    commit(theirs, 'theirs.txt', 'theirs\n', 'Theirs'); sh(theirs, 'push', '-q')
    writeFileSync(join(mine, 'shared.txt'), 'dirty\n')
    await expect(git.sync(mine, 'rebase')).rejects.toThrow(/stash/)
    expect(readFileSync(join(mine, 'shared.txt'), 'utf8')).toBe('dirty\n')
  })
})

describe('Stashes', () => {
  it('pops a stash by oid and stashes staged changes only', async () => {
    writeFileSync(join(mine, 'shared.txt'), 'changed\n'); writeFileSync(join(mine, 'new.txt'), 'new\n')
    await git.stash(mine, 'Work in progress')
    const [entry] = await git.stashes(mine)
    expect((await git.status(mine)).entries).toHaveLength(0)
    await git.popStash(mine, entry!.oid)
    expect(await git.stashes(mine)).toHaveLength(0)
    expect(readFileSync(join(mine, 'new.txt'), 'utf8')).toBe('new\n')
    sh(mine, 'add', 'shared.txt')
    await git.stash(mine, 'Staged only', true)
    const left = (await git.status(mine)).entries.map((e) => e.path)
    expect(left).toEqual(['new.txt'])
    expect((await git.stashes(mine))[0]?.subject).toContain('Staged only')
  })
})
