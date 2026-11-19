import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { actionsSecretNames, setActionsSecrets } from '../src/workspace/forge/github'

let dir: string
let path: string | undefined
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ramu-actions-'))
  // A `gh` that answers every API call the way GitHub does for a missing repository or one the account cannot administer.
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\necho "gh: Not Found (HTTP 404)" >&2\nexit 1\n')
  chmodSync(join(bin, 'gh'), 0o755)
  path = process.env.PATH
  process.env.PATH = `${bin}:${path ?? ''}`
  const repo = join(dir, 'repo')
  execFileSync('git', ['init', '-q', repo])
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/missing.git'], { cwd: repo })
})
afterEach(() => {
  process.env.PATH = path
  rmSync(dir, { recursive: true, force: true })
})

it('says what to do when GitHub cannot find the repository or its Actions secrets, instead of the raw 404', async () => {
  const repo = join(dir, 'repo')
  await expect(actionsSecretNames(repo)).rejects.toThrow(/GitHub cannot find this repository.*Settings → Git/)
  await expect(setActionsSecrets(repo, { API_KEY: 'x' })).rejects.toThrow(/GitHub cannot find this repository/)
})
