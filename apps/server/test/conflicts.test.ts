import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { conflictFile, resolveAllConflicts, resolveConflict } from '../src/workspace/conflicts'
import { status } from '../src/workspace/git'

let dir: string
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
const write = (path: string, text: string) => writeFileSync(join(dir, path), text)

/** Two branches that change the same lines of a.txt, delete/modify b.txt, and touch c.txt cleanly. */
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-conflicts-')))
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  write('a.txt', 'one\ntwo\nthree\nfour\nx1\nx2\nx3\nx4\nfive\n')
  write('b.txt', 'keep me\n')
  write('c.txt', 'c\n')
  git('add', '.')
  git('commit', '-qm', 'base')
  git('switch', '-qc', 'feature')
  write('a.txt', 'one\nTWO feature\nthree\nfour\nx1\nx2\nx3\nx4\nFIVE feature\n')
  write('b.txt', 'changed on feature\n')
  write('c.txt', 'c feature\n')
  git('commit', '-qam', 'feature')
  git('switch', '-q', 'main')
  write('a.txt', 'one\ntwo main\nthree\nfour\nx1\nx2\nx3\nx4\nfive main\n')
  git('rm', '-q', 'b.txt')
  git('commit', '-qam', 'main')
  try {
    git('merge', '-q', '--no-edit', 'feature')
  } catch {
    // The conflicts are the point.
  }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const conflicted = async () =>
  (await status(dir)).entries.filter((entry) => entry.staged === 'unmerged').map((entry) => entry.path)

describe('resolving conflicts by side', () => {
  it('shows each conflict and resolves them one at a time, staging the file when none are left', async () => {
    const file = await conflictFile(dir, 'a.txt')
    expect(file.hunks).toHaveLength(2)
    expect(file.hunks[0]!.current).toEqual(['two main'])
    expect(file.hunks[0]!.incoming).toEqual(['TWO feature'])
    expect(await resolveConflict(dir, 'a.txt', 'incoming', { hunk: 0, hash: file.hash! })).toEqual({ resolved: false })
    expect(await conflicted()).toContain('a.txt')
    await expect(resolveConflict(dir, 'a.txt', 'current', { hunk: 0, hash: file.hash! })).rejects.toThrow('changed')
    expect(await resolveConflict(dir, 'a.txt', 'both', { hunk: 0 })).toEqual({ resolved: true })
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe(
      'one\nTWO feature\nthree\nfour\nx1\nx2\nx3\nx4\nfive main\nFIVE feature\n',
    )
    expect(await conflicted()).not.toContain('a.txt')
  })

  it('takes a whole side of a file with no markers, deleting it when that side deleted it', async () => {
    const file = await conflictFile(dir, 'b.txt')
    expect(file).toMatchObject({ current: false, incoming: true, hunks: [] })
    await expect(resolveConflict(dir, 'b.txt', 'both')).rejects.toThrow('cannot keep both')
    await resolveConflict(dir, 'b.txt', 'incoming')
    expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('changed on feature\n')
    expect(await conflicted()).toEqual(['a.txt'])
  })

  it('resolves every conflicted file at once and keeps what Git merged cleanly', async () => {
    const result = await resolveAllConflicts(dir, 'current')
    expect(result).toEqual({ resolved: 2, skipped: [] })
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('one\ntwo main\nthree\nfour\nx1\nx2\nx3\nx4\nfive main\n')
    expect(readFileSync(join(dir, 'c.txt'), 'utf8')).toBe('c feature\n')
    expect(await conflicted()).toEqual([])
    expect(git('ls-files', 'b.txt').trim()).toBe('')
  })

  it('refuses a file that is not conflicted', async () => {
    await expect(conflictFile(dir, 'c.txt')).rejects.toThrow('no conflict')
  })
})
