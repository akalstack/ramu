import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as git from '../src/workspace/git'

let tmp: string
let repo: string
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ramu-git-'))
  repo = join(tmp, 'repository with spaces')
  sh(tmp, 'init', '-q', '-b', 'main', repo)
  sh(repo, 'config', 'user.email', 'test@example.com')
  sh(repo, 'config', 'user.name', 'Test Author')
  sh(repo, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(repo, 'hello.txt'), 'one\n')
  sh(repo, 'add', '.')
  sh(repo, 'commit', '-q', '-m', 'Initial commit')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('Git management', () => {
  it('undoes the latest commit while preserving staged and unstaged work and the full message', async () => {
    const parent = await git.headOid(repo)
    writeFileSync(join(repo, 'hello.txt'), 'committed\n')
    await git.stage(repo, ['hello.txt'])
    const head = await git.commit(repo, 'Feature title\n\nFeature body')
    writeFileSync(join(repo, 'hello.txt'), 'staged after commit\n')
    await git.stage(repo, ['hello.txt'])
    writeFileSync(join(repo, 'hello.txt'), 'unstaged after commit\n')
    const index = sh(repo, 'write-tree')
    expect(await git.undoCommit(repo, head)).toBe('Feature title\n\nFeature body')
    expect(await git.headOid(repo)).toBe(parent)
    expect(sh(repo, 'write-tree')).toBe(index)
    expect(sh(repo, 'diff', '--cached')).toContain('+staged after commit')
    expect(readFileSync(join(repo, 'hello.txt'), 'utf8')).toBe('unstaged after commit\n')
    await expect(git.undoCommit(repo, head)).rejects.toThrow(/latest commit changed/)
    expect(await git.headOid(repo)).toBe(parent)
  })
  it('rejects undo for a pushed HEAD and during a Git operation', async () => {
    writeFileSync(join(repo, 'hello.txt'), 'local\n')
    await git.stage(repo, ['hello.txt'])
    const head = await git.commit(repo, 'Local commit')
    writeFileSync(join(repo, '.git', 'MERGE_HEAD'), `${head}\n`)
    await expect(git.undoCommit(repo, head)).rejects.toThrow(/repository state/)
    rmSync(join(repo, '.git', 'MERGE_HEAD'))
    const remote = join(tmp, 'remote.git')
    sh(tmp, 'init', '-q', '--bare', remote)
    sh(repo, 'remote', 'add', 'origin', remote)
    sh(repo, 'push', '-q', '-u', 'origin', 'main')
    await expect(git.undoCommit(repo, head)).rejects.toThrow(/already on the upstream/)
    expect(await git.headOid(repo)).toBe(head)
  })
  it('lists real commits and local branches, and opens a commit diff', async () => {
    const commits = await git.history(repo)
    expect(commits[0]).toMatchObject({ subject: 'Initial commit', author: 'Test Author' })
    expect((await git.branches(repo))[0]).toMatchObject({ name: 'main', current: true })
    expect(await git.commitDetails(repo, commits[0]!.oid)).toContain('+one')
    await expect(git.commitDetails(repo, '--exec')).rejects.toThrow(/Invalid/)
  })
  it('amends staged content while preserving the full message and unstaged edits', async () => {
    sh(repo, 'commit', '--amend', '-q', '-m', 'Original title\n\nOriginal body')
    const head = await git.headOid(repo)
    writeFileSync(join(repo, 'hello.txt'), 'staged amendment\n')
    await git.stage(repo, ['hello.txt'])
    writeFileSync(join(repo, 'hello.txt'), 'unstaged edit\n')
    const amended = await git.commit(repo, '', head!)
    expect(amended).not.toBe(head)
    expect(sh(repo, 'rev-list', '--count', 'HEAD')).toBe('1')
    expect(sh(repo, 'log', '-1', '--format=%B')).toBe('Original title\n\nOriginal body')
    expect(sh(repo, 'show', 'HEAD:hello.txt')).toBe('staged amendment')
    expect(readFileSync(join(repo, 'hello.txt'), 'utf8')).toBe('unstaged edit\n')
  })
  it('rejects a stale amend target and supports message-only amendments', async () => {
    const original = await git.headOid(repo)
    const amended = await git.commit(repo, 'Revised title', original!)
    await expect(git.commit(repo, 'Stale title', original!)).rejects.toThrow(/latest commit changed/)
    expect(await git.headOid(repo)).toBe(amended)
    expect(sh(repo, 'log', '-1', '--format=%s')).toBe('Revised title')
    await expect(git.commit(repo, '')).rejects.toThrow(/message is required/)
  })
  it('allows amending a commit already on the upstream without changing the remote', async () => {
    const remote = join(tmp, 'remote.git')
    sh(tmp, 'init', '-q', '--bare', remote)
    sh(repo, 'remote', 'add', 'origin', remote)
    sh(repo, 'push', '-q', '-u', 'origin', 'main')
    const pushed = await git.headOid(repo)
    expect(await git.commit(repo, 'Rewrite', pushed!)).not.toBe(pushed)
    expect(sh(repo, 'rev-parse', 'origin/main')).toBe(pushed)
    expect(sh(repo, 'log', '-1', '--format=%s')).toBe('Rewrite')
    writeFileSync(join(repo, 'hello.txt'), 'local\n')
    await git.stage(repo, ['hello.txt'])
    const local = await git.commit(repo, 'Local work')
    expect(await git.commit(repo, 'Local work, amended', local)).not.toBe(local)
  })
  it('switches clean branches but preserves dirty files and the index when switching is refused', async () => {
    sh(repo, 'branch', 'feature')
    await git.checkout(repo, 'feature')
    expect(await git.currentBranch(repo)).toBe('feature')
    writeFileSync(join(repo, 'hello.txt'), 'dirty\n')
    sh(repo, 'add', 'hello.txt')
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
    sh(other, 'config', 'user.email', 'other@example.com')
    sh(other, 'config', 'user.name', 'Other')
    sh(other, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(other, 'hello.txt'), 'two\n')
    sh(other, 'add', '.')
    sh(other, 'commit', '-q', '-m', 'Remote edit')
    sh(other, 'push', '-q')
    await git.fetch(repo)
    expect((await git.status(repo)).behind).toBe(1)
    // Only behind: the comparison shows what a pull would bring.
    expect(await git.compareUpstream(repo)).toContain('+two')
    await git.pull(repo)
    expect(readFileSync(join(repo, 'hello.txt'), 'utf8')).toBe('two\n')
    expect((await git.history(repo))[0]!.subject).toBe('Remote edit')
  })
  it('preserves dirty files through autostash and refuses divergent fast-forward pulls', async () => {
    const remote = join(tmp, 'remote.git')
    sh(tmp, 'init', '-q', '--bare', remote)
    sh(repo, 'remote', 'add', 'origin', remote)
    await git.push(repo)
    writeFileSync(join(repo, 'hello.txt'), 'dirty\n')
    await git.pull(repo)
    expect(readFileSync(join(repo, 'hello.txt'), 'utf8')).toBe('dirty\n')
    sh(repo, 'restore', 'hello.txt')
    const other = join(tmp, 'other')
    sh(tmp, 'clone', '-q', '-b', 'main', remote, other)
    sh(other, 'config', 'user.email', 'other@example.com')
    sh(other, 'config', 'user.name', 'Other')
    sh(other, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(other, 'remote.txt'), 'remote\n')
    sh(other, 'add', '.')
    sh(other, 'commit', '-q', '-m', 'Remote')
    sh(other, 'push', '-q')
    writeFileSync(join(repo, 'local.txt'), 'local\n')
    sh(repo, 'add', '.')
    sh(repo, 'commit', '-q', '-m', 'Local')
    const head = await git.headOid(repo)
    await expect(git.pull(repo, 'ff-only')).rejects.toThrow(/fast-forward/)
    expect(await git.headOid(repo)).toBe(head)
    expect(sh(repo, 'status', '--porcelain')).toBe('')
  })
  it('draft input contains only staged changes and changes its fingerprint when staging changes', async () => {
    writeFileSync(join(repo, 'hello.txt'), 'staged\n')
    await git.stage(repo, ['hello.txt'])
    writeFileSync(join(repo, 'hello.txt'), 'unstaged secret\n')
    const first = await git.stagedPatch(repo)
    expect(first.patch).toContain('+staged')
    expect(first.patch).not.toContain('unstaged secret')
    await git.stage(repo, ['hello.txt'])
    expect((await git.stagedPatch(repo)).fingerprint).not.toBe(first.fingerprint)
  })
})

describe('commits not pushed yet', () => {
  it('marks nothing without a remote, everything for a never-published branch, and only new commits after publishing', async () => {
    expect((await git.history(repo)).map((commit) => commit.outgoing)).toEqual([false])
    const remote = join(tmp, 'remote.git')
    sh(tmp, 'init', '-q', '--bare', '-b', 'main', remote)
    sh(repo, 'remote', 'add', 'origin', remote)
    expect((await git.history(repo)).map((commit) => commit.outgoing)).toEqual([true])
    sh(repo, 'push', '-q', '--set-upstream', 'origin', 'main')
    writeFileSync(join(repo, 'hello.txt'), 'two\n')
    sh(repo, 'commit', '-q', '-am', 'Second')
    expect((await git.history(repo)).map((commit) => commit.outgoing)).toEqual([true, false])
  })
})

describe('commits not pulled yet', () => {
  it('lists what the upstream has and this branch does not first, marked incoming, after a fetch', async () => {
    const remote = join(tmp, 'remote.git')
    sh(tmp, 'init', '-q', '--bare', '-b', 'main', remote)
    sh(repo, 'remote', 'add', 'origin', remote)
    sh(repo, 'push', '-q', '--set-upstream', 'origin', 'main')
    const other = join(tmp, 'other')
    sh(tmp, 'clone', '-q', remote, other)
    sh(other, 'config', 'user.email', 'other@example.com')
    sh(other, 'config', 'user.name', 'Other')
    writeFileSync(join(other, 'theirs.txt'), 'theirs\n')
    sh(other, 'add', 'theirs.txt')
    sh(other, 'commit', '-q', '-m', 'Their change')
    sh(other, 'push', '-q')
    expect((await git.history(repo)).some((commit) => commit.incoming)).toBe(false)
    sh(repo, 'fetch', '-q')
    const commits = await git.history(repo)
    expect(commits[0]).toMatchObject({ subject: 'Their change', incoming: true, outgoing: false })
    expect(commits.slice(1).some((commit) => commit.incoming)).toBe(false)
  })
})

describe('the remote a branch publishes to', () => {
  const bare = (name: string) => {
    const path = join(tmp, `${name}.git`)
    sh(tmp, 'init', '-q', '--bare', path)
    return path
  }

  it('uses origin, or the only remote', async () => {
    sh(repo, 'remote', 'add', 'fork', bare('fork'))
    expect(await git.publishRemote(repo, 'main')).toEqual({ remote: 'fork', remotes: ['fork'] })
    sh(repo, 'remote', 'add', 'origin', bare('origin'))
    expect((await git.publishRemote(repo, 'main')).remote).toBe('origin')
  })

  it('refuses to guess between several remotes with none named origin', async () => {
    const fork = bare('fork')
    sh(repo, 'remote', 'add', 'fork', fork)
    sh(repo, 'remote', 'add', 'upstream', bare('upstream'))
    expect(await git.publishRemote(repo, 'main')).toEqual({ remote: null, remotes: ['fork', 'upstream'] })
    await expect(git.push(repo)).rejects.toThrow(/several remotes \(fork, upstream\).*Choose one when you publish/)
    expect(sh(tmp, '--git-dir', fork, 'branch', '--list')).toBe('')
  })

  it('offers the remotes to choose between, publishes to the chosen one and refuses a name that is not a remote', async () => {
    const fork = bare('fork')
    sh(repo, 'remote', 'add', 'fork', fork)
    expect(await git.remoteChoices(repo)).toBeNull()
    sh(repo, 'remote', 'add', 'upstream', bare('upstream'))
    expect(await git.remoteChoices(repo)).toEqual(['fork', 'upstream'])
    await expect(git.push(repo, undefined, 'nowhere')).rejects.toThrow(/no remote named nowhere/)
    await git.push(repo, undefined, 'fork')
    expect(sh(repo, 'rev-parse', '--abbrev-ref', 'main@{upstream}')).toBe('fork/main')
    expect(sh(tmp, '--git-dir', fork, 'rev-parse', 'main')).toBe(sh(repo, 'rev-parse', 'HEAD'))
    // Once the branch has an upstream there is nothing left to choose.
    expect(await git.remoteChoices(repo)).toBeNull()
  })

  it("follows the branch's pushRemote, then remote.pushDefault, and ignores names that are not remotes", async () => {
    const fork = bare('fork')
    sh(repo, 'remote', 'add', 'fork', fork)
    sh(repo, 'remote', 'add', 'upstream', bare('upstream'))
    sh(repo, 'config', 'remote.pushDefault', 'missing')
    expect((await git.publishRemote(repo, 'main')).remote).toBeNull()
    sh(repo, 'config', 'remote.pushDefault', 'upstream')
    expect((await git.publishRemote(repo, 'main')).remote).toBe('upstream')
    sh(repo, 'config', 'branch.main.pushRemote', 'fork')
    expect((await git.publishRemote(repo, 'main')).remote).toBe('fork')
    await git.push(repo)
    expect(sh(repo, 'rev-parse', '--abbrev-ref', 'main@{upstream}')).toBe('fork/main')
    expect(sh(tmp, '--git-dir', fork, 'rev-parse', 'main')).toBe(sh(repo, 'rev-parse', 'HEAD'))
  })
})

describe('a remote that never answers', () => {
  it.skipIf(process.platform === 'win32')(
    'stops the command and its helpers instead of holding the repository',
    async () => {
      const marker = join(tmp, 'helper-pid')
      const helper = join(tmp, 'stall.sh')
      writeFileSync(helper, `#!/bin/sh\necho $$ > '${marker}'\nexec sleep 30\n`, { mode: 0o755 })
      sh(repo, 'config', 'protocol.ext.allow', 'always')
      sh(repo, 'remote', 'add', 'stalled', `ext::${helper}`)
      const started = Date.now()
      // Long enough for git to start the helper on a busy machine, so there is a helper to find stopped.
      await expect(git.git(repo, ['fetch', 'stalled'], { timeoutMs: 3_000 })).rejects.toThrow(
        /did not finish within 3 seconds/,
      )
      expect(Date.now() - started).toBeLessThan(15_000)
      const pid = Number(readFileSync(marker, 'utf8').trim())
      const alive = () => {
        try {
          process.kill(pid, 0)
          return true
        } catch {
          return false
        }
      }
      await expect.poll(alive).toBe(false)
    },
  )
})
