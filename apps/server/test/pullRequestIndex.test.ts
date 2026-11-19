import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PullRequestSummary, RepositoryBinding, Task } from '@ramu/shared/types'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import type { AgentService } from '../src/agent'
import { PullRequestIndex } from '../src/background/pullRequestIndex'
import { listInvolvedPullRequests, listPullRequests, listRepositoryPullRequests } from '../src/workspace/forge'
import { currentBranch } from '../src/workspace/git'

vi.mock('../src/workspace/forge', () => ({
  listPullRequests: vi.fn(),
  listInvolvedPullRequests: vi.fn(),
  listRepositoryPullRequests: vi.fn(),
}))
vi.mock('../src/workspace/git', () => ({ currentBranch: vi.fn() }))

let db: Db, ws: Workspace, index: PullRequestIndex, changed: () => void
let tasks: Task[]
let bindings: Record<string, Partial<RepositoryBinding>>

const pr = (overrides: Partial<PullRequestSummary>): PullRequestSummary => ({
  number: 1,
  title: 'Change',
  url: 'https://github.com/o/r/pull/1',
  state: 'open',
  draft: false,
  baseBranch: 'main',
  headBranch: 'feature',
  author: 'me',
  fork: false,
  reviewDecision: null,
  checks: 'failure',
  mergeable: 'clean',
  openThreads: 0,
  requestedReviewers: [],
  group: 'mine',
  updatedAt: 10,
  ...overrides,
})
const task = (id: string, lastActiveAt: number) => ({ id, title: id, status: 'idle', lastActiveAt }) as Task

const at = async (ms: number) => {
  vi.setSystemTime(1_000_000_000_000 + ms)
  await index.tick()
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  db = openDb(':memory:')
  ws = new Workspace(db, '/tmp/ramu-pr-index-test')
  tasks = [task('worktree', 1), task('old-shared', 2), task('new-shared', 3)]
  bindings = {
    worktree: { mode: 'worktree', taskBranch: 'feature' },
    'old-shared': { mode: 'current', taskBranch: null },
    'new-shared': { mode: 'current', taskBranch: null },
  }
  vi.spyOn(ws, 'listTasks').mockImplementation(() => tasks)
  vi.spyOn(ws, 'listBindings').mockImplementation((id: string) => [
    { repoId: 'repo', cwd: '/repo', setupState: 'ready', ...bindings[id] } as RepositoryBinding,
  ])
  vi.spyOn(ws, 'getRepository').mockReturnValue({ id: 'repo', projectId: 'p', name: 'r', root: '/repo' })
  vi.mocked(currentBranch).mockResolvedValue('shared-branch')
  vi.mocked(listInvolvedPullRequests).mockResolvedValue([])
  vi.mocked(listPullRequests).mockResolvedValue({
    availability: 'ready',
    viewer: 'me',
    pullRequests: [
      pr({}),
      pr({ number: 2, url: 'https://github.com/o/r/pull/2', headBranch: 'shared-branch', checks: 'success' }),
      pr({ number: 3, url: 'https://github.com/o/r/pull/3', headBranch: 'fork-branch', fork: true }),
    ],
  })
  changed = vi.fn()
  const agents = { list: () => [] } as unknown as AgentService
  index = new PullRequestIndex(ws, agents, changed)
})
afterEach(async () => {
  await index.stop()
  db.close()
  vi.useRealTimers()
})

describe('pull requests on thread rows', () => {
  it('links a worktree thread by its branch and only the latest thread in the shared checkout', async () => {
    await at(0)
    expect(index.forTask(tasks[0]!)).toMatchObject({ number: 1, stage: 'checks-failing' })
    expect(index.forTask(tasks[1]!)).toBeNull()
    expect(index.forTask(tasks[2]!)).toMatchObject({ number: 2, stage: 'review-required' })
    expect(vi.mocked(changed)).toHaveBeenCalled()
    expect(index.viewer('repo')).toBe('me')
  })

  it('keeps a link after the branch moves on, with its last-known state refreshed by later looks', async () => {
    await at(0)
    vi.mocked(currentBranch).mockResolvedValue('main')
    vi.mocked(listPullRequests).mockResolvedValue({
      availability: 'ready',
      viewer: 'me',
      pullRequests: [
        pr({ state: 'merged', checks: 'success' }),
        pr({ number: 2, url: 'https://github.com/o/r/pull/2', headBranch: 'shared-branch', state: 'merged' }),
      ],
    })
    await at(10 * 60_000)
    expect(index.forTask(tasks[2]!)).toMatchObject({ number: 2, state: 'merged', stage: 'merged' })
    expect(index.forTask(tasks[0]!)).toMatchObject({ stage: 'merged' })
  })

  it('does not ask again before the list is stale, and backs off when the service is unavailable', async () => {
    await at(0)
    await at(30_000)
    expect(listPullRequests).toHaveBeenCalledTimes(1)
    index.invalidate('repo')
    vi.mocked(listPullRequests).mockResolvedValue({ availability: 'signed-out', viewer: null, pullRequests: [] })
    await at(31_000)
    await at(5 * 60_000)
    expect(listPullRequests).toHaveBeenCalledTimes(2)
  })

  it('shows replies ready when drafts wait for the person', async () => {
    await at(0)
    index.drafts = () => [
      {
        kind: 'replies',
        id: 'b',
        url: 'https://github.com/o/r/pull/1',
        number: 1,
        repoId: 'repo',
        branch: 'feature',
        sessionId: 's',
        threads: [],
        drafts: [{ threadId: 't', outcome: 'question', reply: 'Which one?', commit: null }],
        reviewers: [],
        createdAt: 1,
      },
    ]
    expect(index.forTask(tasks[0]!)?.stage).toBe('replies-ready')
  })
})

/** This repository's own checkout: the page lists only folders with Git. */
const CHECKOUT = fileURLToPath(new URL('../../..', import.meta.url))

describe('the Pull requests page', () => {
  beforeEach(() => {
    vi.spyOn(ws, 'listProjects').mockReturnValue([
      { id: 'p', name: 'Shop' },
      { id: 'q', name: 'Shop again' },
      { id: 'no-project', name: 'No project' },
    ] as ReturnType<Workspace['listProjects']>)
    vi.spyOn(ws, 'listRepositories').mockImplementation((projectId: string) =>
      projectId === 'no-project' ? [] : [{ id: `repo-${projectId}`, projectId, name: 'r', root: CHECKOUT }],
    )
  })

  it('lists every project repository once, with the threads on each pull request', async () => {
    await at(0)
    const pages = await index.overview({ includeClosed: false, force: true })
    expect(pages.map((entry) => entry.projectName)).toEqual(['Shop', 'Shop again'])
    // The same remote reached from two projects shows its pull requests only under the first.
    expect(pages[0]!.pullRequests.map((entry) => entry.number)).toEqual([1, 2, 3])
    expect(pages[1]!.pullRequests).toEqual([])
    expect(pages[0]!.threads?.['https://github.com/o/r/pull/1']).toEqual([{ taskId: 'worktree', title: 'worktree' }])
  })

  it('keeps the other repositories when one cannot be read', async () => {
    vi.mocked(listPullRequests)
      .mockRejectedValueOnce(new Error('gh: not signed in'))
      .mockResolvedValue({ availability: 'ready', viewer: 'me', pullRequests: [pr({})] })
    const pages = await index.overview({ includeClosed: false, force: true })
    expect(pages.map((entry) => entry.error ?? null)).toEqual(['gh: not signed in', null])
    expect(pages[1]!.pullRequests).toHaveLength(1)
  })
})

describe('pull requests elsewhere', () => {
  beforeEach(() => {
    vi.spyOn(ws, 'listProjects').mockReturnValue([{ id: 'p', name: 'Shop' }] as ReturnType<Workspace['listProjects']>)
    vi.spyOn(ws, 'listRepositories').mockReturnValue([{ id: 'repo-p', projectId: 'p', name: 'r', root: CHECKOUT }])
  })

  it('adds the open pull requests that involve the account in repositories no project holds, once', async () => {
    vi.mocked(listInvolvedPullRequests).mockResolvedValue([
      // Already listed under the project: not repeated.
      { viewer: 'me', repository: 'o/r', pr: pr({}) },
      { viewer: 'me', repository: 'friend/site', pr: pr({ number: 7, url: 'https://github.com/friend/site/pull/7' }) },
    ])
    const pages = await index.overview({ includeClosed: false, force: true })
    expect(pages.map((entry) => [entry.repoName, entry.outside ?? false, entry.pullRequests.length])).toEqual([
      ['r', false, 3],
      ['friend/site', true, 1],
    ])
    expect(listInvolvedPullRequests).toHaveBeenCalledTimes(1)
    // The merged and closed list stays to the projects' own repositories.
    vi.mocked(listInvolvedPullRequests).mockClear()
    await index.overview({ includeClosed: true, force: false })
    expect(listInvolvedPullRequests).not.toHaveBeenCalled()
  })

  it('reads a repository in no project through the checkout whose account found it', async () => {
    const elsewhere = pr({ number: 7, url: 'https://github.com/friend/site/pull/7', group: 'review' })
    vi.mocked(listInvolvedPullRequests).mockResolvedValue([{ viewer: 'me', repository: 'friend/site', pr: elsewhere }])
    vi.mocked(listRepositoryPullRequests).mockResolvedValue({
      availability: 'ready',
      viewer: 'me',
      pullRequests: [elsewhere],
    })
    // A host that has not listed the page yet searches before answering.
    expect(await index.outsideRoot('Friend/Site')).toBe(CHECKOUT)
    expect(await index.outsideRoot('someone/else')).toBeNull()
    vi.mocked(listPullRequests).mockClear()
    const list = await index.list(CHECKOUT, 'outside:friend/site', { includeClosed: false, force: false })
    expect(list.pullRequests.map((entry) => entry.url)).toEqual([elsewhere.url])
    expect(listRepositoryPullRequests).toHaveBeenCalledWith(CHECKOUT, 'friend/site')
    expect(listPullRequests).not.toHaveBeenCalled()
    // Served from the cache until forced, and still found after the search stops listing it, as once it is merged.
    await index.list(CHECKOUT, 'outside:friend/site', { includeClosed: true, force: false })
    expect(listRepositoryPullRequests).toHaveBeenCalledTimes(1)
    vi.mocked(listInvolvedPullRequests).mockResolvedValue([])
    await index.overview({ includeClosed: false, force: true })
    expect(await index.outsideRoot('friend/site')).toBe(CHECKOUT)
  })

  it('keeps the page when the search elsewhere fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(listInvolvedPullRequests).mockRejectedValue(new Error('rate limited'))
    const pages = await index.overview({ includeClosed: false, force: true })
    expect(pages.map((entry) => entry.repoName)).toEqual(['r'])
  })
})
