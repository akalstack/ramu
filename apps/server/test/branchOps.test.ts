import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as git from '../src/workspace/git'

describe('branch operations', () => {
  let tmp: string
  const sh = (...args: string[]) => execFileSync('git', args, { cwd: tmp, encoding: 'utf8' }).trim()
  const commit = (file: string) => {
    writeFileSync(join(tmp, file), file)
    sh('add', '.')
    sh('commit', '-q', '-m', file)
  }
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ramu-branch-'))
    execFileSync('git', ['init', '-q', '-b', 'main', tmp])
    sh('config', 'user.email', 't@example.com')
    sh('config', 'user.name', 'T')
    sh('config', 'commit.gpgsign', 'false')
    commit('base.txt')
  })
  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('creates a branch from another branch and renames the current one', async () => {
    sh('branch', 'topic')
    await git.createBranchFrom(tmp, 'next', 'topic')
    expect(sh('branch', '--show-current')).toBe('next')
    await git.renameBranch(tmp, 'renamed')
    expect(sh('branch', '--show-current')).toBe('renamed')
    await expect(git.renameBranch(tmp, 'main')).rejects.toThrow(/already exists/)
  })

  it('merges another branch and refuses to merge a branch into itself', async () => {
    sh('switch', '-q', '-c', 'feature')
    commit('feature.txt')
    sh('switch', '-q', 'main')
    await git.mergeBranch(tmp, 'feature')
    expect(sh('log', '--format=%s', '-1')).toBe('feature.txt')
    await expect(git.mergeBranch(tmp, 'main')).rejects.toThrow(/different branch/)
  })

  it('leaves a conflicting merge open with a clear message', async () => {
    sh('switch', '-q', '-c', 'feature')
    commit('base.txt-x')
    writeFileSync(join(tmp, 'base.txt'), 'feature')
    sh('commit', '-qam', 'feature edit')
    sh('switch', '-q', 'main')
    writeFileSync(join(tmp, 'base.txt'), 'main')
    sh('commit', '-qam', 'main edit')
    await expect(git.mergeBranch(tmp, 'feature')).rejects.toThrow(/Merge stopped on conflicts/)
    expect((await git.status(tmp)).operation).toBe('merge')
  })
})
