import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { adapterFor, adapterForOrigin } from '../src/workspace/forge/route'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function checkout(remote: string | null) {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-forge-route-'))
  dirs.push(dir)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir })
  return dir
}

it('routes a checkout to the adapter for its remote and keeps GitHub for anything else', async () => {
  expect((await adapterFor(checkout('git@gitlab.com:group/sub/app.git'))).id).toBe('gitlab')
  expect((await adapterFor(checkout('https://github.com/owner/app.git'))).id).toBe('github')
  expect((await adapterFor(checkout('https://git.example.com/owner/app.git'))).id).toBe('github')
  expect((await adapterFor(checkout(null))).id).toBe('github')
})

it('says a recognised service without an adapter is not supported instead of trying GitHub', async () => {
  await expect(adapterFor(checkout('git@bitbucket.org:team/app.git'))).rejects.toThrow('Bitbucket')
  await expect(adapterForOrigin('dev.azure.com')).rejects.toThrow('Azure DevOps')
})
