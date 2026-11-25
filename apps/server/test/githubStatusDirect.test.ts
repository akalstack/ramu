import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { pullRequestStatus } from '../src/workspace/forge/github'

let dir: string, repo: string, marker: string
let path: string | undefined
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ramu-pr-direct-'))
  marker = join(dir, 'pr-view-ran')
  // A signed-in `gh` whose token reads GitHub directly; `pr view` leaves a mark and finds nothing.
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/sh\nif [ "$1" = auth ]; then echo token-from-gh; exit 0; fi\ntouch "${marker}"\necho "no pull requests found for branch" >&2\nexit 1\n`,
  )
  chmodSync(join(bin, 'gh'), 0o755)
  path = process.env.PATH
  process.env.PATH = `${bin}:${path ?? ''}`
  repo = join(dir, 'repo')
  execFileSync('git', ['init', '-q', '-b', 'feature', repo])
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/app.git'], { cwd: repo })
})
afterEach(() => {
  vi.unstubAllGlobals()
  process.env.PATH = path
  rmSync(dir, { recursive: true, force: true })
})

const pull = {
  number: 7,
  title: 'Feature',
  html_url: 'https://github.com/example/app/pull/7',
  state: 'open',
  draft: false,
  base: { ref: 'main' },
  head: { ref: 'feature', sha: 'abc' },
}

it("reads the branch's pull request straight from GitHub with gh's token, without starting gh pr view", async () => {
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    expect((init.headers as Record<string, string>).Authorization).toContain('token-from-gh')
    const body = url.includes('/pulls?head=')
      ? [pull]
      : url.includes('/check-runs')
        ? { check_runs: [] }
        : url.includes('/status')
          ? { statuses: [] }
          : []
    return new Response(JSON.stringify(body), { status: 200 })
  })
  vi.stubGlobal('fetch', fetcher)
  const status = await pullRequestStatus(repo)
  expect(status.pullRequest).toMatchObject({ number: 7, url: pull.html_url, state: 'open' })
  expect(existsSync(marker)).toBe(false)
})

it('asks gh when the direct read finds nothing, since gh also finds a pull request opened from a fork', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]', { status: 200 })),
  )
  const status = await pullRequestStatus(repo)
  expect(status.pullRequest).toBeNull()
  expect(existsSync(marker)).toBe(true)
})
