import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as git from '../src/main/git'

let tmp: string
let repo: string
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ramu-git-'))
  repo = join(tmp, 'repository with spaces')
  sh(tmp, 'init', '-q', '-b', 'main', repo)
  sh(repo, 'config', 'user.email', 'test@example.com'); sh(repo, 'config', 'user.name', 'Test Author'); sh(repo, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(repo, 'hello.txt'), 'one\n')
  sh(repo, 'add', '.'); sh(repo, 'commit', '-q', '-m', 'Initial commit')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('Git management', () => {
  it('lists real commits and local branches, and opens a commit diff', async () => {
    const commits = await git.history(repo)
    expect(commits[0]).toMatchObject({ subject: 'Initial commit', author: 'Test Author' })
    expect((await git.branches(repo))[0]).toMatchObject({ name: 'main', current: true })
    expect(await git.commitDetails(repo, commits[0]!.oid)).toContain('+one')
    await expect(git.commitDetails(repo, '--exec')).rejects.toThrow(/Invalid/)
  })
  it('switches clean branches but preserves dirty files and the index when switching is refused', async () => {
    sh(repo, 'branch', 'feature')
    await git.checkout(repo, 'feature')
    expect(await git.currentBranch(repo)).toBe('feature')
    writeFileSync(join(repo, 'hello.txt'), 'dirty\n'); sh(repo, 'add', 'hello.txt')
    const before = sh(repo, 'diff', '--cached')
    await expect(git.checkout(repo, 'main')).rejects.toThrow(/working changes/)
    expect(await git.currentBranch(repo)).toBe('feature')
    expect(sh(repo, 'diff', '--cached')).toBe(before)
    expect(readFileSync(join(repo, 'hello.txt'), 'utf8')).toBe('dirty\n')
  })
  it('publishes a branch, fetches, compares upstream and fast-forwards from a local remote', async () => {
    const remote = join(tmp, 'remote.git')
    sh(tmp, 'init', '-q', '--bare', remote)
    sh(repo, 'remote', 'add', 'origin', remote)
    await git.push(repo)
    expect((await git.status(repo)).upstream).toBe('origin/main')
    const other = join(tmp, 'other')
    sh(tmp, 'clone', '-q', '-b', 'main', remote, other)
    sh(other, 'config', 'user.email', 'other@example.com'); sh(other, 'config', 'user.name', 'Other'); sh(other, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(other, 'hello.txt'), 'two\n'); sh(other, 'add', '.'); sh(other, 'commit', '-q', '-m', 'Remote edit'); sh(other, 'push', '-q')
    await git.fetch(repo)
    expect((await git.status(repo)).behind).toBe(1)
    expect(await git.compareUpstream(repo)).toContain('hello.txt')
    await git.pull(repo)
    expect(readFileSync(join(repo, 'hello.txt'), 'utf8')).toBe('two\n')
    expect((await git.history(repo))[0]!.subject).toBe('Remote edit')
  })
  it('refuses a pull on dirty files and refuses divergent history without merging', async () => {
    const remote = join(tmp, 'remote.git'); sh(tmp, 'init', '-q', '--bare', remote); sh(repo, 'remote', 'add', 'origin', remote); await git.push(repo)
    writeFileSync(join(repo, 'hello.txt'), 'dirty\n')
    await expect(git.pull(repo)).rejects.toThrow(/working changes/)
    expect(readFileSync(join(repo, 'hello.txt'), 'utf8')).toBe('dirty\n')
    sh(repo, 'restore', 'hello.txt')
    const other = join(tmp, 'other'); sh(tmp, 'clone', '-q', '-b', 'main', remote, other)
    sh(other, 'config', 'user.email', 'other@example.com'); sh(other, 'config', 'user.name', 'Other'); sh(other, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(other, 'remote.txt'), 'remote\n'); sh(other, 'add', '.'); sh(other, 'commit', '-q', '-m', 'Remote'); sh(other, 'push', '-q')
    writeFileSync(join(repo, 'local.txt'), 'local\n'); sh(repo, 'add', '.'); sh(repo, 'commit', '-q', '-m', 'Local')
    const head = await git.headOid(repo)
    await expect(git.pull(repo, 'ff-only')).rejects.toThrow(/fast-forward/)
    expect(await git.headOid(repo)).toBe(head)
    expect(sh(repo, 'status', '--porcelain')).toBe('')
  })
  it('draft input contains only staged changes and changes its fingerprint when staging changes', async () => {
    writeFileSync(join(repo, 'hello.txt'), 'staged\n'); await git.stage(repo, ['hello.txt'])
    writeFileSync(join(repo, 'hello.txt'), 'unstaged secret\n')
    const first = await git.stagedPatch(repo)
    expect(first.patch).toContain('+staged')
    expect(first.patch).not.toContain('unstaged secret')
    await git.stage(repo, ['hello.txt'])
    expect((await git.stagedPatch(repo)).fingerprint).not.toBe(first.fingerprint)
  })
})
