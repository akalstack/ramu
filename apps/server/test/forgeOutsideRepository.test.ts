import { beforeEach, expect, it, vi } from 'vitest'
import type { PullRequestSummary } from '@ramu/shared/types'
import { registerForgeHandlers } from '../src/ipc/handlers/forge'
import * as forge from '../src/workspace/forge'

vi.mock('../src/workspace/forge', () => ({
  reviewThreads: vi.fn(async () => []),
  pullRequestBody: vi.fn(async () => 'Body'),
  pullRequestAction: vi.fn(async () => {}),
  listPullRequests: vi.fn(),
  serviceOf: vi.fn(async () => 'github'),
}))

const URL_HERE = 'https://github.com/friend/site/pull/7'
const ROOT = '/work/shop'
const pr = (overrides: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
  number: 7,
  title: 'Fix the header',
  url: URL_HERE,
  state: 'open',
  draft: false,
  baseBranch: 'main',
  headBranch: 'header',
  author: 'friend',
  fork: false,
  reviewDecision: null,
  checks: null,
  mergeable: 'clean',
  openThreads: 0,
  requestedReviewers: [],
  group: 'review',
  updatedAt: 1,
  ...overrides,
})

let gitCwdOf: ReturnType<typeof vi.fn>
let list: ReturnType<typeof vi.fn>
let invalidate: ReturnType<typeof vi.fn>
const deployed = vi.fn()
const setup = () =>
  registerForgeHandlers({
    workspace: { listTasks: () => [] },
    gitCwdOf,
    forgeAccounts: { describe: (error: unknown) => (error instanceof Error ? error.message : String(error)) },
    agents: {},
    host: {},
    deploys: { pushed: deployed },
    pullRequestIndex: {
      outsideRoot: async (repository: string) => (repository.toLowerCase() === 'friend/site' ? ROOT : null),
      list,
      invalidate,
      tick: async () => {},
      threadsFor: () => [],
    },
  } as never)

beforeEach(() => {
  vi.clearAllMocks()
  gitCwdOf = vi.fn(() => {
    throw new Error('A repository in no project has no checkout.')
  })
  list = vi.fn(async () => ({ availability: 'ready', viewer: 'me', pullRequests: [pr()] }))
  invalidate = vi.fn()
})

it('accepts a repository in no project only in its exact shape, with room for long GitHub names', () => {
  const args = setup()['forge.reviewThreads']!.args
  const valid = (repoId: string) => args.safeParse(['project:', repoId, URL_HERE]).success
  expect(valid('outside:friend/site')).toBe(true)
  expect(valid(`outside:${'a'.repeat(39)}/${'b'.repeat(100)}`)).toBe(true)
  expect(valid('repo-1')).toBe(true)
  for (const bad of ['outside:friend', 'outside:friend/site/more', 'outside:../site', `r${'x'.repeat(100)}`])
    expect(valid(bad)).toBe(false)
})

it('reads a pull request of a repository in no project as the account that found it', async () => {
  const methods = setup()
  await methods['forge.reviewThreads']!.run('project:', 'outside:friend/site', URL_HERE)
  expect(forge.reviewThreads).toHaveBeenCalledWith(ROOT, URL_HERE)
  expect(await methods['forge.pullRequestDescription']!.run('project:', 'outside:friend/site', URL_HERE)).toBe('Body')
  const listed = (await methods['forge.pullRequests']!.run('project:', 'outside:friend/site', false, false)) as {
    threads: Record<string, unknown>
  }
  expect(list).toHaveBeenCalledWith(ROOT, 'outside:friend/site', { includeClosed: false, force: false })
  expect(listed.threads).toEqual({ [URL_HERE]: [] })
  expect(gitCwdOf).not.toHaveBeenCalled()
})

it('refuses pull requests of other repositories and repositories no account here found', async () => {
  const methods = setup()
  await expect(
    methods['forge.reviewThreads']!.run('project:', 'outside:friend/site', 'https://github.com/someone/else/pull/1'),
  ).rejects.toThrow('not in friend/site')
  await expect(
    methods['forge.reviewThreads']!.run('project:', 'outside:someone/else', 'https://github.com/someone/else/pull/1'),
  ).rejects.toThrow('Refresh the pull requests')
  expect(forge.reviewThreads).not.toHaveBeenCalled()
})

it('merges through the service without following a deployment, and sends conflicts to cloning the repository', async () => {
  const methods = setup()
  const merge = { kind: 'merge', method: 'squash', deleteBranch: false } as const
  await methods['forge.pullRequestAction']!.run('project:', 'outside:friend/site', URL_HERE, merge)
  expect(forge.pullRequestAction).toHaveBeenCalledWith(ROOT, URL_HERE, merge)
  expect(deployed).not.toHaveBeenCalled()

  list.mockResolvedValue({ availability: 'ready', viewer: 'me', pullRequests: [pr({ mergeable: 'conflicts' })] })
  await expect(methods['forge.updateBranch']!.run('project:', 'outside:friend/site', URL_HERE)).rejects.toThrow(
    'Clone this repository as a project',
  )
})
