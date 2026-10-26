import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as git from '../src/workspace/git'

// A bare remote with two clones: "mine" is the checkout under test, "theirs" pushes competing commits.
let tmp: string, remote: string, mine: string, theirs: string
const sh = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
const configure = (dir: string) => {
  sh(dir, 'config', 'user.email', 'test@example.com')
  sh(dir, 'config', 'user.name', 'Test')
  sh(dir, 'config', 'commit.gpgsign', 'false')
}
const commit = (dir: string, file: string, text: string, message: string) => {
  writeFileSync(join(dir, file), text)
  sh(dir, 'add', file)
  sh(dir, 'commit', '-q', '-m', message)
}
const parents = (dir: string) => sh(dir, 'log', '-1', '--format=%P').split(' ').filter(Boolean).length

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ramu-sync-'))
  remote = join(tmp, 'remote.git')
  mine = join(tmp, 'mine')
  theirs = join(tmp, 'theirs')
  sh(tmp, 'init', '-q', '--bare', '-b', 'main', remote)
  sh(tmp, 'clone', '-q', remote, mine)
  configure(mine)
  commit(mine, 'shared.txt', 'base\n', 'Base')
  sh(mine, 'push', '-q', '-u', 'origin', 'main')
  sh(tmp, 'clone', '-q', remote, theirs)
  configure(theirs)
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('Sync and pull modes', () => {
  it('rebase sync on diverged branches keeps history linear and pushes', async () => {
    commit(theirs, 'theirs.txt', 'theirs\n', 'Theirs')
    sh(theirs, 'push', '-q')
    commit(mine, 'mine.txt', 'mine\n', 'Mine')
    await git.sync(mine, 'rebase', { branch: 'main', oid: sh(mine, 'rev-parse', 'HEAD'), targetBranch: 'main' })
    expect(parents(mine)).toBe(1)
    expect(sh(mine, 'log', '--format=%s')).toBe('Mine\nTheirs\nBase')
    expect(sh(remote, 'log', '-1', '--format=%s', 'main')).toBe('Mine')
    expect((await git.status(mine)).operation).toBeNull()
  })
  it('merge mode creates a merge commit', async () => {
    commit(theirs, 'theirs.txt', 'theirs\n', 'Theirs')
    sh(theirs, 'push', '-q')
    commit(mine, 'mine.txt', 'mine\n', 'Mine')
    sh(mine, 'config', 'pull.ff', 'only') // merge mode must override a fast-forward-only config
    await git.pull(mine, 'merge')
    expect(parents(mine)).toBe(2)
  })
  it('fast-forward-only refuses diverged branches', async () => {
    commit(theirs, 'theirs.txt', 'theirs\n', 'Theirs')
    sh(theirs, 'push', '-q')
    commit(mine, 'mine.txt', 'mine\n', 'Mine')
    await expect(git.pull(mine, 'ff-only')).rejects.toThrow()
    expect(sh(mine, 'log', '-1', '--format=%s')).toBe('Mine')
  })
  it('a conflicting rebase reports the operation, blocks sync, and abort restores the checkout', async () => {
    commit(theirs, 'shared.txt', 'theirs\n', 'Theirs edit')
    sh(theirs, 'push', '-q')
    commit(mine, 'shared.txt', 'mine\n', 'My edit')
    const head = sh(mine, 'rev-parse', 'HEAD')
    await expect(
      git.sync(mine, 'rebase', { branch: 'main', oid: sh(mine, 'rev-parse', 'HEAD'), targetBranch: 'main' }),
    ).rejects.toThrow(/conflict in 1 file.*Abort the rebase. Nothing was pushed/)
    expect((await git.status(mine)).operation).toBe('rebase')
    await expect(
      git.sync(mine, 'rebase', { branch: 'main', oid: sh(mine, 'rev-parse', 'HEAD'), targetBranch: 'main' }),
    ).rejects.toThrow(/rebase is in progress/)
    await expect(git.continueOperation(mine)).rejects.toThrow(/Resolve and stage/)
    expect(sh(remote, 'log', '-1', '--format=%s', 'main')).toBe('Theirs edit') // nothing pushed after the failed pull
    await git.abortOperation(mine)
    expect((await git.status(mine)).operation).toBeNull()
    expect(sh(mine, 'rev-parse', 'HEAD')).toBe(head)
  })
  it('continuing a resolved rebase finishes it', async () => {
    commit(theirs, 'shared.txt', 'theirs\n', 'Theirs edit')
    sh(theirs, 'push', '-q')
    commit(mine, 'shared.txt', 'mine\n', 'My edit')
    await expect(git.pull(mine, 'rebase')).rejects.toThrow()
    writeFileSync(join(mine, 'shared.txt'), 'resolved\n')
    sh(mine, 'add', 'shared.txt')
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
    try {
      sh(wt, 'rebase', 'main')
    } catch {
      /* conflict expected */
    }
    expect((await git.status(wt)).operation).toBe('rebase')
    expect((await git.status(mine)).operation).toBeNull()
    await git.abortOperation(wt)
    expect((await git.status(wt)).operation).toBeNull()
  })
  it('publishes a branch without an upstream', async () => {
    sh(mine, 'switch', '-q', '-c', 'topic')
    commit(mine, 'topic.txt', 'topic\n', 'Topic')
    await git.sync(mine, 'rebase', { branch: 'main', oid: sh(mine, 'rev-parse', 'HEAD'), targetBranch: 'main' })
    expect(sh(remote, 'log', '-1', '--format=%s', 'topic')).toBe('Topic')
  })
  it.each(['rebase', 'merge', 'ff-only'] as const)('%s Pull autostashes and restores working changes', async (mode) => {
    commit(theirs, 'theirs.txt', 'theirs\n', 'Theirs')
    sh(theirs, 'push', '-q')
    writeFileSync(join(mine, 'shared.txt'), 'dirty\n')
    sh(mine, 'config', 'merge.autoStash', 'false')
    sh(mine, 'config', 'rebase.autoStash', 'false')
    await git.pull(mine, mode)
    expect(readFileSync(join(mine, 'shared.txt'), 'utf8')).toBe('dirty\n')
    expect(sh(mine, 'log', '-1', '--format=%s')).toBe('Theirs')
    expect(await git.stashes(mine)).toEqual([])
  })
  it.each([false, true])(
    'rebase sync autostashes tracked edits (staged: %s), restores them, and pushes commits',
    async (staged) => {
      commit(theirs, 'theirs.txt', 'remote\n', 'Remote')
      sh(theirs, 'push', '-q')
      commit(mine, 'mine.txt', 'local\n', 'Local')
      writeFileSync(join(mine, 'shared.txt'), 'working edit\n')
      if (staged) sh(mine, 'add', 'shared.txt')
      writeFileSync(join(mine, 'untracked.txt'), 'keep this\n')
      sh(mine, 'config', 'rebase.autoStash', 'false')
      await git.sync(mine, 'rebase', { branch: 'main', oid: sh(mine, 'rev-parse', 'HEAD'), targetBranch: 'main' })
      expect(readFileSync(join(mine, 'shared.txt'), 'utf8')).toBe('working edit\n')
      expect(readFileSync(join(mine, 'untracked.txt'), 'utf8')).toBe('keep this\n')
      expect(sh(mine, 'log', '--format=%s')).toBe('Local\nRemote\nBase')
      expect(sh(remote, 'log', '-1', '--format=%s', 'main')).toBe('Local')
      expect(await git.stashes(mine)).toEqual([])
    },
  )
  it('does not push when restoring an autostash causes conflicts', async () => {
    commit(theirs, 'shared.txt', 'remote edit\n', 'Remote')
    sh(theirs, 'push', '-q')
    commit(mine, 'mine.txt', 'local\n', 'Local')
    writeFileSync(join(mine, 'shared.txt'), 'working edit\n')
    await expect(
      git.sync(mine, 'rebase', { branch: 'main', oid: sh(mine, 'rev-parse', 'HEAD'), targetBranch: 'main' }),
    ).rejects.toThrow(/autostashed changes caused conflicts.*Nothing was pushed/)
    expect(sh(remote, 'log', '-1', '--format=%s', 'main')).toBe('Remote')
    expect((await git.status(mine)).entries.some((entry) => entry.staged === 'unmerged')).toBe(true)
    expect(await git.stashes(mine)).toHaveLength(1)
  })
})

describe('Automatic pull', () => {
  const incoming = async () => {
    commit(theirs, 'shared.txt', 'remote update\n', 'Remote update')
    sh(theirs, 'push', '-q')
    await git.fetch(mine)
  }
  it('fast-forwards a clean checkout without pushing or creating a merge commit', async () => {
    await incoming()
    sh(mine, 'config', 'pull.rebase', 'true')
    sh(mine, 'config', 'merge.ff', 'false')
    expect(await git.autoPull(mine)).toBe(true)
    expect(await git.headOid(mine)).toBe(await git.headOid(theirs))
    expect(readFileSync(join(mine, 'shared.txt'), 'utf8')).toBe('remote update\n')
    expect(parents(mine)).toBe(1)
    expect(await git.autoPull(mine)).toBe(false)
  })
  it.each(['unstaged', 'staged', 'untracked'])('skips %s changes without stashing or modifying files', async (kind) => {
    await incoming()
    const head = await git.headOid(mine)
    const file = kind === 'untracked' ? 'new.txt' : 'shared.txt'
    writeFileSync(join(mine, file), 'local work\n')
    if (kind === 'staged') sh(mine, 'add', file)
    sh(mine, 'config', 'merge.autoStash', 'true')
    expect(await git.autoPull(mine)).toBe(false)
    expect(await git.headOid(mine)).toBe(head)
    expect(readFileSync(join(mine, file), 'utf8')).toBe('local work\n')
    expect(await git.stashes(mine)).toEqual([])
  })
  it('skips diverged branches and leaves local and remote history untouched', async () => {
    await incoming()
    commit(mine, 'mine.txt', 'local commit\n', 'Local commit')
    const head = await git.headOid(mine),
      remoteHead = await git.headOid(theirs)
    expect(await git.autoPull(mine)).toBe(false)
    expect(await git.headOid(mine)).toBe(head)
    expect(sh(remote, 'rev-parse', 'main')).toBe(remoteHead)
    expect((await git.status(mine)).operation).toBeNull()
  })
  it('skips detached HEAD, branches without upstream, and a merge in progress', async () => {
    await incoming()
    const head = await git.headOid(mine)
    sh(mine, 'switch', '-q', '--detach')
    expect(await git.autoPull(mine)).toBe(false)
    sh(mine, 'switch', '-q', '-c', 'no-upstream')
    expect(await git.autoPull(mine)).toBe(false)
    sh(mine, 'switch', '-q', 'main')
    writeFileSync(join(mine, '.git', 'MERGE_HEAD'), `${await git.headOid(theirs)}\n`)
    expect(await git.autoPull(mine)).toBe(false)
    expect(await git.headOid(mine)).toBe(head)
  })
  it('protects ignored local files when incoming commits start tracking them', async () => {
    commit(mine, '.gitignore', 'private.txt\n', 'Ignore private file')
    sh(mine, 'push', '-q')
    sh(theirs, 'pull', '--ff-only')
    writeFileSync(join(theirs, 'private.txt'), 'remote file\n')
    sh(theirs, 'add', '-f', 'private.txt')
    sh(theirs, 'commit', '-q', '-m', 'Track file')
    sh(theirs, 'push', '-q')
    writeFileSync(join(mine, 'private.txt'), 'local private file\n')
    await git.fetch(mine)
    const head = await git.headOid(mine)
    await expect(git.autoPull(mine)).rejects.toThrow()
    expect(await git.headOid(mine)).toBe(head)
    expect(readFileSync(join(mine, 'private.txt'), 'utf8')).toBe('local private file\n')
  })
})

describe('Stashes', () => {
  it('lists tracked and untracked stash files and reads their saved diffs', async () => {
    commit(mine, 'deleted.txt', 'delete me\n', 'Deletion fixture')
    commit(mine, 'rename.txt', 'rename me\n', 'Rename fixture')
    writeFileSync(join(mine, 'shared.txt'), 'saved change\n')
    rmSync(join(mine, 'deleted.txt'))
    sh(mine, 'mv', 'rename.txt', 'renamed.txt')
    writeFileSync(join(mine, 'staged.txt'), 'staged addition\n')
    sh(mine, 'add', 'staged.txt')
    writeFileSync(join(mine, 'new file\twith tab.txt'), 'untracked addition\n')
    await git.stash(mine, 'Contents')
    const [entry] = await git.stashes(mine)
    expect(await git.stashFiles(mine, entry!.oid)).toEqual(
      expect.arrayContaining([
        { path: 'shared.txt', status: 'M' },
        { path: 'deleted.txt', status: 'D' },
        { path: 'renamed.txt', origPath: 'rename.txt', status: 'R' },
        { path: 'staged.txt', status: 'A' },
        { path: 'new file\twith tab.txt', status: 'A' },
      ]),
    )
    writeFileSync(join(mine, 'shared.txt'), 'later change\n')
    expect(await git.stashFileDiff(mine, entry!.oid, 'shared.txt')).toEqual({
      original: 'base\n',
      modified: 'saved change\n',
    })
    expect(await git.stashFileDiff(mine, entry!.oid, 'deleted.txt')).toEqual({ original: 'delete me\n', modified: '' })
    expect(await git.stashFileDiff(mine, entry!.oid, 'renamed.txt')).toEqual({
      original: 'rename me\n',
      modified: 'rename me\n',
    })
    expect(await git.stashFileDiff(mine, entry!.oid, 'staged.txt')).toEqual({
      original: '',
      modified: 'staged addition\n',
    })
    expect(await git.stashFileDiff(mine, entry!.oid, 'new file\twith tab.txt')).toEqual({
      original: '',
      modified: 'untracked addition\n',
    })
    await expect(git.stashFileDiff(mine, entry!.oid, 'not-in-stash.txt')).rejects.toThrow()
    expect(readFileSync(join(mine, 'shared.txt'), 'utf8')).toBe('later change\n')
  })
  it('reads a tracked-only stash and rejects invalid stash identifiers', async () => {
    writeFileSync(join(mine, 'shared.txt'), 'staged change\n')
    sh(mine, 'add', 'shared.txt')
    await git.stash(mine, 'Staged only', true)
    const [entry] = await git.stashes(mine)
    expect(await git.stashFiles(mine, entry!.oid)).toEqual([{ path: 'shared.txt', status: 'M' }])
    expect(await git.stashFileDiff(mine, entry!.oid, 'shared.txt')).toEqual({
      original: 'base\n',
      modified: 'staged change\n',
    })
    await expect(git.stashFiles(mine, 'HEAD')).rejects.toThrow('Invalid stash identifier')
    await expect(git.stashFiles(mine, sh(mine, 'rev-parse', 'HEAD'))).rejects.toThrow('not a stash')
  })

  it('pops a stash by oid and stashes staged changes only', async () => {
    writeFileSync(join(mine, 'shared.txt'), 'changed\n')
    writeFileSync(join(mine, 'new.txt'), 'new\n')
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

  it('refuses to apply or pop over uncommitted changes and says which action it refused', async () => {
    writeFileSync(join(mine, 'shared.txt'), 'saved\n')
    await git.stash(mine, 'Saved')
    const [entry] = await git.stashes(mine)
    writeFileSync(join(mine, 'dirty.txt'), 'dirty\n')
    await expect(git.popStash(mine, entry!.oid)).rejects.toThrow('before popping a stash')
    await expect(git.applyStash(mine, entry!.oid)).rejects.toThrow('before applying a stash')
    await expect(git.checkout(mine, 'main')).rejects.toThrow('before switching branches or pulling')
    expect(await git.stashes(mine)).toHaveLength(1)
  })
})

describe('Commit on a feature branch', () => {
  it('creates from HEAD, commits only the index, and publishes without changing main', async () => {
    const main = sh(mine, 'rev-parse', 'main')
    writeFileSync(join(mine, 'shared.txt'), 'staged feature\n')
    await git.stage(mine, ['shared.txt'])
    writeFileSync(join(mine, 'shared.txt'), 'unstaged edit\n')
    writeFileSync(join(mine, 'untracked.txt'), 'keep me\n')
    const head = await git.commit(mine, 'Feature commit', undefined, {
      expectedBranch: 'main',
      newBranch: 'feature/example',
    })
    expect(await git.currentBranch(mine)).toBe('feature/example')
    expect(sh(mine, 'rev-parse', 'main')).toBe(main)
    expect(sh(mine, 'show', 'HEAD:shared.txt')).toBe('staged feature')
    expect(readFileSync(join(mine, 'shared.txt'), 'utf8')).toBe('unstaged edit\n')
    expect(readFileSync(join(mine, 'untracked.txt'), 'utf8')).toBe('keep me\n')
    expect((await git.status(mine)).upstream).toBeNull()
    await git.push(mine)
    expect(sh(remote, 'rev-parse', 'feature/example')).toBe(head)
    expect(sh(remote, 'rev-parse', 'main')).toBe(main)
    expect((await git.status(mine)).upstream).toBe('origin/feature/example')
  })
  it('detects a custom remote default and falls back to main without remote HEAD', async () => {
    expect(await git.commitBranchInfo(mine)).toEqual({ branch: 'main', defaultBranch: 'main' })
    sh(mine, 'branch', 'trunk')
    sh(mine, 'update-ref', 'refs/remotes/origin/trunk', 'HEAD')
    sh(mine, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')
    expect(await git.commitBranchInfo(mine)).toEqual({ branch: 'main', defaultBranch: 'trunk' })
  })
  it('rejects stale, invalid, and existing branch choices without changing HEAD or the index', async () => {
    writeFileSync(join(mine, 'shared.txt'), 'staged\n')
    await git.stage(mine, ['shared.txt'])
    const head = await git.headOid(mine),
      index = sh(mine, 'write-tree')
    for (const choice of [
      { expectedBranch: 'stale', newBranch: 'feature/new' },
      { expectedBranch: 'main', newBranch: 'invalid name' },
      { expectedBranch: 'main', newBranch: 'main' },
    ]) {
      await expect(git.commit(mine, 'Feature', undefined, choice)).rejects.toThrow()
      expect(await git.currentBranch(mine)).toBe('main')
      expect(await git.headOid(mine)).toBe(head)
      expect(sh(mine, 'write-tree')).toBe(index)
    }
  })
  it('requires staged changes and rejects a merge in progress before switching', async () => {
    await expect(
      git.commit(mine, 'Feature', undefined, { expectedBranch: 'main', newBranch: 'feature/new' }),
    ).rejects.toThrow(/Stage changes/)
    writeFileSync(join(mine, 'shared.txt'), 'staged\n')
    await git.stage(mine, ['shared.txt'])
    writeFileSync(join(mine, '.git', 'MERGE_HEAD'), `${sh(mine, 'rev-parse', 'HEAD')}\n`)
    await expect(
      git.commit(mine, 'Feature', undefined, { expectedBranch: 'main', newBranch: 'feature/new' }),
    ).rejects.toThrow(/Git operation/)
    expect(await git.currentBranch(mine)).toBe('main')
  })
  it('continues on main when explicitly chosen', async () => {
    writeFileSync(join(mine, 'shared.txt'), 'staged\n')
    await git.stage(mine, ['shared.txt'])
    await git.commit(mine, 'Direct commit', undefined, { expectedBranch: 'main' })
    await git.push(mine)
    expect(await git.currentBranch(mine)).toBe('main')
    expect(sh(remote, 'log', '-1', '--format=%s', 'main')).toBe('Direct commit')
  })
})

it('does not push a different branch after committing', async () => {
  sh(mine, 'switch', '-q', '-c', 'feature/original')
  commit(mine, 'topic.txt', 'topic\n', 'Topic')
  sh(mine, 'switch', '-q', 'main')
  await expect(git.push(mine, 'feature/original')).rejects.toThrow(/Nothing was pushed/)
  expect(sh(remote, 'log', '-1', '--format=%s', 'main')).toBe('Base')
})

describe('protected branch sync', () => {
  it('pulls a protected branch without confirmation when there is nothing to push', async () => {
    commit(theirs, 'remote.txt', 'remote\n', 'Remote update')
    sh(theirs, 'push', '-q')
    await git.sync(mine)
    expect(sh(mine, 'rev-parse', 'HEAD')).toBe(sh(remote, 'rev-parse', 'main'))
  })
  it('requires confirmation before pushing, and leaves the remote unchanged when approval is absent or stale', async () => {
    const original = sh(remote, 'rev-parse', 'main')
    commit(mine, 'local.txt', 'local\n', 'Local update')
    await expect(git.sync(mine)).rejects.toThrow('Protected branch confirmation required:')
    await expect(git.sync(mine, 'rebase', { branch: 'main', oid: original, targetBranch: 'main' })).rejects.toThrow(
      'Protected branch confirmation required:',
    )
    expect(sh(remote, 'rev-parse', 'main')).toBe(original)
    await git.sync(mine, 'rebase', { branch: 'main', oid: sh(mine, 'rev-parse', 'HEAD'), targetBranch: 'main' })
    expect(sh(remote, 'rev-parse', 'main')).toBe(sh(mine, 'rev-parse', 'HEAD'))
  })
  it('protects publishing a branch without an upstream even though its ahead count is zero', async () => {
    sh(mine, 'checkout', '-qb', 'staging')
    expect((await git.status(mine)).ahead).toBe(0)
    await expect(git.sync(mine)).rejects.toThrow('Protected branch confirmation required:')
    expect(sh(remote, 'branch', '--list', 'staging')).toBe('')
  })
  it('protects a feature branch that pushes to a protected upstream', async () => {
    sh(mine, 'checkout', '-qb', 'feature')
    sh(mine, 'branch', '--set-upstream-to=origin/main')
    commit(mine, 'local.txt', 'local\n', 'Local update')
    await expect(git.sync(mine)).rejects.toThrow('"targetBranch":"main"')
    expect(sh(remote, 'log', '-1', '--format=%s', 'main')).toBe('Base')
  })
  it('allows a feature branch to sync without confirmation', async () => {
    sh(mine, 'checkout', '-qb', 'feature')
    commit(mine, 'local.txt', 'local\n', 'Feature update')
    await git.sync(mine)
    expect(sh(remote, 'rev-parse', 'feature')).toBe(sh(mine, 'rev-parse', 'HEAD'))
  })
})
