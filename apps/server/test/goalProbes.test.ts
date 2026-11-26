import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { realGoalProbes } from '../src/agent/goalProbes'
import { changedSince, unlistedChanges } from '../src/agent/goalEvidence'

// Real git and a real shell, with real timers: the goal tests stub both so their clocks can be advanced.
let dir: string
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ramu-goal-probes-'))
  git('init', '-q')
  git('config', 'user.email', 'a@b.c')
  git('config', 'user.name', 'Test')
  writeFileSync(join(dir, 'tracked.ts'), 'one\n')
  git('add', '.')
  git('commit', '-qm', 'init')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('workspace snapshot', () => {
  it('hashes modified and untracked files, and sees what changed since an earlier snapshot', async () => {
    const before = (await realGoalProbes.snapshot(dir))!
    expect(before.files).toEqual({})
    writeFileSync(join(dir, 'tracked.ts'), 'two\n')
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'new.ts'), 'fresh\n')
    const after = (await realGoalProbes.snapshot(dir))!
    expect(Object.keys(after.files).sort()).toEqual(['src/new.ts', 'tracked.ts'])
    expect(Object.keys(changedSince(before.files, after)).sort()).toEqual(['src/new.ts', 'tracked.ts'])
    // Editing a file that was already dirty is a change; leaving it alone is not.
    expect(changedSince(after.files, after)).toEqual({})
    writeFileSync(join(dir, 'tracked.ts'), 'three\n')
    expect(Object.keys(changedSince(after.files, (await realGoalProbes.snapshot(dir))!))).toEqual(['tracked.ts'])
  })

  it('works from a subfolder with the evidence check, and reports no repository outside git', async () => {
    mkdirSync(join(dir, 'pkg'))
    const before = (await realGoalProbes.snapshot(join(dir, 'pkg')))!
    writeFileSync(join(dir, 'pkg', 'a.ts'), 'x\n')
    const after = (await realGoalProbes.snapshot(join(dir, 'pkg')))!
    const changed = changedSince(before.files, after)
    const evidence = (changedFiles: string[]) => ({ checks: [{ name: 'test', passed: true }], changedFiles })
    const at = { snapshot: after, changed, cwd: join(dir, 'pkg') }
    expect(unlistedChanges(evidence([]), at)).toContain('pkg/a.ts')
    // The agent may say it relative to the folder it works in, relative to the repository, or absolute.
    for (const path of ['a.ts', 'pkg/a.ts', join(dir, 'pkg', 'a.ts'), 'pkg'])
      expect(unlistedChanges(evidence([path]), at), path).toEqual([])
    const outside = mkdtempSync(join(tmpdir(), 'ramu-no-git-'))
    try {
      expect(await realGoalProbes.snapshot(outside)).toBeNull()
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('verification command', () => {
  const run = (command: string, signal = new AbortController().signal) => realGoalProbes.verify(dir, command, signal)

  it('passes on exit code 0 and keeps the output', async () => {
    expect(await run('echo checked && echo warn 1>&2')).toMatchObject({ ok: true, code: 0, timedOut: false })
    expect((await run('echo checked && echo warn 1>&2')).output).toContain('checked')
  })

  it('fails with the exit code and the output of a failing command, run in the workspace', async () => {
    writeFileSync(join(dir, 'marker.txt'), 'here')
    const result = await run('cat marker.txt; echo broken; exit 3')
    expect(result).toMatchObject({ ok: false, code: 3, timedOut: false })
    expect(result.output).toContain('here')
    expect(result.output).toContain('broken')
  })

  it('ends the whole process group when stopped', async () => {
    const controller = new AbortController()
    const started = Date.now()
    const pending = run('sleep 30 & wait', controller.signal)
    setTimeout(() => controller.abort(), 100)
    const result = await pending
    expect(result.ok).toBe(false)
    expect(Date.now() - started).toBeLessThan(5000)
  })
})
