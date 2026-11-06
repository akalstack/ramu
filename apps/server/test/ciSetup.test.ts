import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPullRequest } from '../src/workspace/forge'
import { ciPreview, draftCi, setUpCi } from '../src/workspace/ci/setup'

vi.mock('../src/workspace/forge', () => ({
  forgeRemoteOf: vi.fn(async () => ({ origin: 'github.com', protocol: 'https', owner: 'acme', repo: 'shop' })),
  createPullRequest: vi.fn(async () => ({ pullRequest: { url: 'https://github.com/acme/shop/pull/7' } })),
}))
vi.mock('../src/workspace/forge/route', () => ({ kindOfOrigin: vi.fn(async () => 'github') }))

const dirs: string[] = []
const identity = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@e.st',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@e.st',
}
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(process.env, identity)
})
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  for (const name of Object.keys(identity)) delete process.env[name]
})
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-ci-test-'))
  dirs.push(dir)
  return dir
}
const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })

/** A checkout of a pnpm project whose remote is a local bare repository. */
function repository() {
  const remote = temp()
  run(remote, 'init', '--bare', '-b', 'main')
  const here = temp()
  run(here, 'clone', remote, '.')
  run(here, 'checkout', '-b', 'main')
  writeFileSync(join(here, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .', build: 'vite build' } }))
  writeFileSync(join(here, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
  run(here, 'add', '.')
  run(here, 'commit', '-m', 'first')
  run(here, 'push', '-u', 'origin', 'main')
  return { remote, here }
}

describe('Set up CI', () => {
  it('previews the workflow from the default branch', async () => {
    const { here } = repository()
    const preview = await ciPreview(here)
    expect(preview).toMatchObject({
      forge: 'github',
      path: '.github/workflows/ci.yml',
      toolchain: 'pnpm',
      defaultBranch: 'main',
      exists: false,
    })
    expect(preview.steps.map((step) => step.name)).toEqual(['Lint', 'Build'])
  })

  it('opens a pull request from a new branch without touching the checkout', async () => {
    const { remote, here } = repository()
    run(here, 'checkout', '-b', 'feature/work')
    writeFileSync(join(here, 'notes.txt'), 'unsaved work')
    const result = await setUpCi(here)
    expect(result).toEqual({ url: 'https://github.com/acme/shop/pull/7', path: '.github/workflows/ci.yml' })
    expect(vi.mocked(createPullRequest)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ base: 'main', title: 'Set up CI', draft: false }),
    )
    const workflow = run(remote, 'show', 'ramu/set-up-ci:.github/workflows/ci.yml')
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(run(remote, 'log', '-1', '--format=%s', 'ramu/set-up-ci').trim()).toBe('ci: set up CI')
    // The person's branch, uncommitted file and worktree list are as they were, and no local branch is left behind.
    expect(run(here, 'branch', '--show-current').trim()).toBe('feature/work')
    expect(readFileSync(join(here, 'notes.txt'), 'utf8')).toBe('unsaved work')
    expect(existsSync(join(here, '.github'))).toBe(false)
    expect(run(here, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1)
    expect(run(here, 'branch', '--list', 'ramu/*').trim()).toBe('')
  })

  it('picks a free branch name when an earlier attempt is still on the remote', async () => {
    const { remote, here } = repository()
    await setUpCi(here)
    await setUpCi(here)
    expect(run(remote, 'branch', '--list', 'ramu/*').trim().split(/\s+/)).toEqual([
      'ramu/set-up-ci',
      'ramu/set-up-ci-2',
    ])
  })

  it('refuses when the default branch already has the workflow', async () => {
    const { here } = repository()
    await draftCi(here)
    run(here, 'add', '.')
    run(here, 'commit', '-m', 'ci')
    run(here, 'push')
    expect((await ciPreview(here)).exists).toBe(true)
    await expect(setUpCi(here)).rejects.toThrow('main already has .github/workflows/ci.yml')
    expect(vi.mocked(createPullRequest)).not.toHaveBeenCalled()
  })

  it('writes the draft into an agent’s checkout once, then returns what is there', async () => {
    const { here } = repository()
    const first = await draftCi(here)
    expect(first.written).toBe(true)
    expect(readFileSync(join(here, '.github/workflows/ci.yml'), 'utf8')).toBe(first.workflow.content)
    writeFileSync(join(here, '.github/workflows/ci.yml'), 'name: Mine\n')
    const second = await draftCi(here)
    expect(second).toMatchObject({ written: false, existing: 'name: Mine\n' })
    expect(readFileSync(join(here, '.github/workflows/ci.yml'), 'utf8')).toBe('name: Mine\n')
  })
})
