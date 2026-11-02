import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { continuationFacts, fetchedBranch } from '../src/workspace/git'
import { redactSecrets } from '../src/memory/secrets'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-continue-'))
  dirs.push(dir)
  return dir
}
const run = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@e.st', ...args], { cwd, encoding: 'utf8' })

function repositories() {
  const remote = temp()
  run(remote, 'init', '--bare', '-b', 'main')
  const here = temp()
  run(here, 'clone', remote, '.')
  run(here, 'checkout', '-b', 'main')
  writeFileSync(join(here, 'a.txt'), 'a')
  run(here, 'add', '.')
  run(here, 'commit', '-m', 'first')
  run(here, 'push', '-u', 'origin', 'main')
  return { remote, here }
}

it('reports what stays behind, without counting pushed work', async () => {
  const { here } = repositories()
  expect(await continuationFacts(here)).toMatchObject({ branch: 'main', pushed: true, dirtyFiles: 0, unpushed: 0 })
  writeFileSync(join(here, 'b.txt'), 'b')
  run(here, 'add', '.')
  run(here, 'commit', '-m', 'second')
  writeFileSync(join(here, 'c.txt'), 'c')
  expect(await continuationFacts(here)).toMatchObject({ pushed: true, dirtyFiles: 1, unpushed: 1 })
})

it('fetches a pushed branch for another checkout and leaves that checkout alone', async () => {
  const { remote, here } = repositories()
  run(here, 'checkout', '-b', 'fix')
  writeFileSync(join(here, 'fix.txt'), 'fix')
  run(here, 'add', '.')
  run(here, 'commit', '-m', 'fix')
  run(here, 'push', '-u', 'origin', 'fix')
  const commit = run(here, 'rev-parse', 'HEAD').trim()
  const other = temp()
  run(other, 'clone', '-b', 'main', remote, '.')
  const before = run(other, 'rev-parse', 'HEAD').trim()
  await expect(fetchedBranch(other, 'fix')).resolves.toEqual({ ref: 'refs/remotes/origin/fix', oid: commit })
  expect(run(other, 'rev-parse', 'HEAD').trim()).toBe(before)
  expect(run(other, 'status', '--porcelain')).toBe('')
})

it('removes a planted secret from what travels', () => {
  const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
  expect(redactSecrets(`token ${token} here`)).not.toContain(token)
})
