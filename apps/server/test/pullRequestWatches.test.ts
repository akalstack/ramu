import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionInfo, PullRequestInfo, PullRequestThread } from '@ramu/shared/types'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import type { AgentService } from '../src/agent'
import { PullRequestWatchService } from '../src/background/pullRequestWatches'
import { commitBranchInfo, currentBranch, git, headOid } from '../src/workspace/git'
import {
  commitChecks,
  commitChecksFeedback,
  pullRequestFeedback,
  pullRequestStatus,
  resolvedAccountChoice,
  reviewThreads,
} from '../src/workspace/forge'

vi.mock('../src/workspace/git', () => ({
  currentBranch: vi.fn(),
  commitBranchInfo: vi.fn(),
  headOid: vi.fn(),
  git: vi.fn(),
}))
vi.mock('../src/workspace/forge', () => ({
  commitChecks: vi.fn(),
  commitChecksFeedback: vi.fn(),
  pullRequestFeedback: vi.fn(),
  pullRequestStatus: vi.fn(),
  resolvedConnectionId: vi.fn(async () => null),
  resolvedAccountChoice: vi.fn(async () => null),
  reviewThreads: vi.fn(async () => []),
}))

let db: Db, ws: Workspace, service: PullRequestWatchService
let session: AgentSessionInfo
let archived: boolean, paused: boolean, gone: boolean
let pr: PullRequestInfo
let enqueue: ReturnType<typeof vi.fn>
let agents: AgentService
let threads: PullRequestThread[]
const comment = (id: string, author: string, trusted = true) => ({
  id,
  author,
  bot: false,
  trusted,
  body: `Comment ${id}`,
  createdAt: 1,
})
const thread = (id: string, comments: ReturnType<typeof comment>[], resolved = false): PullRequestThread => ({
  id,
  path: 'src/a.ts',
  line: 3,
  outdated: false,
  resolved,
  resolvable: true,
  comments,
})
const queued = () => ws.getAppState<unknown[]>('test-queue', [])
const createService = () => new PullRequestWatchService(db, ws, agents, () => {})
beforeEach(() => {
  vi.resetAllMocks()
  db = openDb(':memory:')
  ws = new Workspace(db, '/tmp/ramu-pr-watch-test')
  archived = paused = gone = false
  session = { id: 'session', taskId: 'task', state: 'idle', covers: ['/repo'], parentId: null } as AgentSessionInfo
  vi.spyOn(ws, 'listTasks').mockImplementation(
    () =>
      [{ id: 'task', title: 'Fix the build', status: archived ? 'archived' : 'idle', lastActiveAt: 1 }] as ReturnType<
        Workspace['listTasks']
      >,
  )
  vi.spyOn(ws, 'getTask').mockImplementation(() => {
    if (gone) throw new Error('Deleted')
    return ws.listTasks()[0]!
  })
  vi.spyOn(ws, 'getBinding').mockReturnValue({ cwd: '/repo' } as ReturnType<Workspace['getBinding']>)
  enqueue = vi.fn((id: string, text: string, checkout: unknown) => {
    ws.setAppState('test-queue', [...queued(), { id, text, checkout }])
  })
  agents = {
    list: () => [session],
    get: () => session,
    queuePaused: () => paused,
    enqueueBackground: enqueue,
    wakeBackground: vi.fn(),
  } as unknown as AgentService
  pr = {
    number: 7,
    title: 'Fix',
    url: 'https://github.com/o/r/pull/7',
    state: 'open',
    draft: false,
    baseBranch: 'main',
    headBranch: 'fix',
    headCommit: 'sha1',
    reviewDecision: null,
    checks: [{ name: 'Build', state: 'failure', url: 'https://github.com/o/r/actions/runs/1/job/1' }],
  }
  vi.mocked(currentBranch).mockResolvedValue('fix')
  vi.mocked(pullRequestStatus).mockImplementation(async () => ({
    availability: 'ready',
    pullRequest: structuredClone(pr),
  }))
  vi.mocked(pullRequestFeedback).mockImplementation(async (_cwd, kind) => `Feedback: ${kind}. Do not push.`)
  threads = []
  vi.mocked(reviewThreads).mockImplementation(async () => structuredClone(threads))
  service = createService()
})
afterEach(async () => {
  await service.stop()
  db.close()
})
const watch = () => service.watch('/repo', 'repo', pr.url, 'session')

describe('persistent PR watches', () => {
  it('queues once in the chosen thread and does not replay after a restart', async () => {
    await watch()
    expect(service.status('/repo', pr.url)).toEqual({
      sessionId: 'session',
      threads: [{ id: 'session', title: 'Fix the build' }],
    })
    await service.tick(0)
    expect(queued()).toEqual([expect.objectContaining({ id: 'session', checkout: { cwd: '/repo', branch: 'fix' } })])
    expect(enqueue.mock.calls[0]![1]).toContain('Do not push.')
    await service.stop()
    service = createService()
    await service.tick(60_000)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(agents.wakeBackground).toHaveBeenCalledWith('session')
    // Changed head/check runs are new feedback even when the log text is unchanged.
    pr.headCommit = 'sha2'
    await service.tick(120_000)
    expect(enqueue).toHaveBeenCalledTimes(2)
  })

  it('wakes on new review comments of any kind, once each, and ignores settled threads', async () => {
    pr.checks = []
    threads = [thread('old', [comment('c0', 'ana')], true), thread('t1', [comment('c1', 'ana')])]
    await watch()
    await service.tick(0)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(String(enqueue.mock.calls[0]![1])).toContain('Thread id: t1')
    expect(String(enqueue.mock.calls[0]![1])).not.toContain('Thread id: old')
    await service.tick(60_000)
    expect(enqueue).toHaveBeenCalledTimes(1)
    // A plain reply, not a "Request changes" review, still starts the next round.
    threads[1]!.comments.push(comment('c2', 'ana'))
    await service.tick(120_000)
    expect(enqueue).toHaveBeenCalledTimes(2)
    expect(String(enqueue.mock.calls[1]![1])).toContain('[new]')
  })

  it('never starts a round from comments outside the project', async () => {
    pr.checks = []
    threads = [thread('t1', [comment('c1', 'stranger', false)])]
    await watch()
    await service.tick(0)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('retries transient errors and rolls back both queue and receipt on failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await watch()
    enqueue.mockImplementationOnce(() => {
      ws.setAppState('test-queue', ['partial'])
      throw new Error('write failed')
    })
    await service.tick(0)
    expect(queued()).toEqual([])
    await service.tick(60_000)
    expect(queued()).toHaveLength(1)
    await service.tick(120_000)
    expect(enqueue).toHaveBeenCalledTimes(2)
  })

  it.each(['needs-input', 'failed'] as const)('holds feedback while the thread is %s', async (state) => {
    await watch()
    session.state = state
    await service.tick(0)
    expect(enqueue).not.toHaveBeenCalled()
    session.state = 'idle'
    await service.tick(60_000)
    expect(enqueue).toHaveBeenCalledOnce()
  })

  it('holds a paused queue and a switched branch, then resumes without steering', async () => {
    await watch()
    paused = true
    await service.tick(0)
    paused = false
    vi.mocked(currentBranch).mockResolvedValue('other')
    await service.tick(60_000)
    expect(enqueue).not.toHaveBeenCalled()
    vi.mocked(currentBranch).mockResolvedValue('fix')
    session.state = 'running'
    await service.tick(120_000)
    expect(enqueue).toHaveBeenCalledOnce()
  })

  it('rechecks cancellation and thread state after fetching slow feedback', async () => {
    await watch()
    vi.mocked(pullRequestFeedback).mockImplementationOnce(async () => {
      await service.watch('/repo', 'repo', pr.url, null)
      return 'late feedback'
    })
    await service.tick(0)
    expect(enqueue).not.toHaveBeenCalled()
    await watch()
    vi.mocked(pullRequestFeedback).mockImplementationOnce(async () => {
      session.state = 'needs-input'
      return 'late feedback'
    })
    await service.tick(60_000)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it.each(['merged', 'archived', 'deleted', 'stopped'] as const)('removes watches when %s', async (reason) => {
    await watch()
    if (reason === 'merged') pr.state = 'merged'
    if (reason === 'archived') archived = true
    if (reason === 'deleted') gone = true
    if (reason === 'stopped') session.state = 'stopped'
    await service.tick(0)
    expect(service.status('/repo', pr.url).sessionId).toBeNull()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('lets manual fix actions reuse the watched thread and prevents an automatic duplicate', async () => {
    await watch()
    expect(await service.sendFeedback('/repo', 'checks')).toBe('session')
    await service.tick(0)
    expect(enqueue).toHaveBeenCalledOnce()
    await service.watch('/repo', 'repo', pr.url, null)
    expect(await service.sendFeedback('/repo', 'checks')).toBeNull()
  })

  it('observes a recovery before accepting the same failure again', async () => {
    await watch()
    await service.tick(0)
    pr.checks[0]!.state = 'success'
    await service.tick(60_000)
    pr.checks[0]!.state = 'failure'
    await service.tick(120_000)
    expect(enqueue).toHaveBeenCalledTimes(2)
  })

  it('rejects a foreign thread or a PR that changed since the UI loaded', async () => {
    await expect(service.watch('/repo', 'repo', pr.url, 'foreign')).rejects.toThrow('Choose a thread')
    await expect(service.watch('/repo', 'repo', 'https://github.com/o/r/pull/8', 'session')).rejects.toThrow(
      'no longer',
    )
    expect(service.status('/repo', pr.url).sessionId).toBeNull()
  })
})

describe('automatic watches on PR creation', () => {
  const created = () => service.watchCreated('task', '/repo', 'repo', pr)
  it('defaults off for existing profiles and opts in only future PR creations', async () => {
    await created()
    expect(service.status('/repo', pr.url).sessionId).toBeNull()
    ws.setAppState('app-preferences', { autoWatchPullRequests: true })
    expect(service.status('/repo', pr.url).sessionId).toBeNull()
    await created()
    expect(service.status('/repo', pr.url).sessionId).toBe('session')
    ws.setAppState('app-preferences', { autoWatchPullRequests: false })
    expect(service.status('/repo', pr.url).sessionId).toBe('session')
    pr.url = 'https://github.com/o/r/pull/8'
    await created()
    expect(service.status('/repo', pr.url).sessionId).toBeNull()
  })

  it('does not guess a thread for project views, empty threads or other checkouts', async () => {
    ws.setAppState('app-preferences', { autoWatchPullRequests: true })
    gone = true
    await created()
    gone = false
    const list = vi.spyOn(agents, 'list').mockReturnValue([])
    await created()
    list.mockReturnValue([{ ...session, covers: ['/other'] }])
    await created()
    expect(service.status('/repo', pr.url).sessionId).toBeNull()
  })

  it('keeps an explicit watch choice and ends watches when the thread is stopped', async () => {
    await watch()
    ws.setAppState('app-preferences', { autoWatchPullRequests: true })
    await created()
    await service.tick(0)
    await created()
    await service.tick(60_000)
    expect(enqueue).toHaveBeenCalledOnce()
    service.stopForSession('session')
    expect(service.status('/repo', pr.url).sessionId).toBeNull()
  })

  it('ends a watch when the account it was made under is no longer the one in use, and keeps it when that is unknown', async () => {
    vi.mocked(resolvedAccountChoice).mockResolvedValue('cli:me')
    await watch()
    // A locked store or an ambiguous choice says nothing about the account.
    vi.mocked(resolvedAccountChoice).mockResolvedValue(null)
    await service.tick(0)
    expect(service.status('/repo', pr.url).sessionId).toBe('session')
    // Saving and selecting a token switches the identity: the watch ends instead of reading as someone else.
    vi.mocked(resolvedAccountChoice).mockResolvedValue('saved-token')
    await service.tick(60_000)
    expect(service.status('/repo', pr.url).sessionId).toBeNull()
  })
})

describe('pushes to the default branch', () => {
  const push = () => service.watchPush('task', '/repo', 'repo')
  const failing = [{ name: 'CI', state: 'failure' as const, url: 'https://github.com/o/r/actions/runs/2/job/3' }]
  beforeEach(() => {
    vi.mocked(currentBranch).mockResolvedValue('main')
    vi.mocked(commitBranchInfo).mockResolvedValue({ branch: 'main', defaultBranch: 'main' })
    vi.mocked(headOid).mockResolvedValue('abc1234def')
    vi.mocked(commitChecksFeedback).mockResolvedValue('CI failed on main after your push of abc1234.')
  })

  it('wakes the pushing thread once when CI fails on the pushed commit', async () => {
    vi.mocked(commitChecks).mockResolvedValue([{ name: 'CI', state: 'pending', url: null }])
    await push()
    await service.tick(0)
    expect(enqueue).not.toHaveBeenCalled()
    vi.mocked(commitChecks).mockResolvedValue(failing)
    await service.tick(60_000)
    expect(queued()).toEqual([expect.objectContaining({ id: 'session', checkout: { cwd: '/repo', branch: 'main' } })])
    expect(String(enqueue.mock.calls[0]![1])).toContain('CI failed on main')
    expect(String(enqueue.mock.calls[0]![1])).toContain('external feedback')
    expect(vi.mocked(commitChecks)).toHaveBeenCalledWith('/repo', 'abc1234def')
    // Handed over once, also after a restart.
    await service.stop()
    service = createService()
    await service.tick(120_000)
    expect(enqueue).toHaveBeenCalledOnce()
  })

  it('wakes the pull request’s thread when CI fails on the commit a merge made, and only for the default branch', async () => {
    const sha = 'f'.repeat(40)
    vi.mocked(currentBranch).mockResolvedValue('feature')
    vi.mocked(commitBranchInfo).mockResolvedValue({ branch: 'feature', defaultBranch: 'main' })
    vi.mocked(git).mockResolvedValue(`${sha}\trefs/heads/main\n`)
    await service.watchMerge('task', '/repo', 'repo', 'release')
    expect(vi.mocked(git)).not.toHaveBeenCalled()
    await service.watchMerge('task', '/repo', 'repo', 'main')
    expect(vi.mocked(git)).toHaveBeenCalledWith('/repo', ['ls-remote', '--heads', 'origin', 'refs/heads/main'])
    vi.mocked(commitChecks).mockResolvedValue(failing)
    await service.tick(0)
    expect(vi.mocked(commitChecks)).toHaveBeenCalledWith('/repo', sha)
    expect(enqueue).toHaveBeenCalledOnce()
  })

  it('stops following a commit whose checks pass, and ignores pushes of other branches', async () => {
    vi.mocked(commitChecks).mockResolvedValue([{ name: 'CI', state: 'success', url: null }])
    await push()
    await service.tick(0)
    vi.mocked(commitChecks).mockResolvedValue(failing)
    await service.tick(60_000)
    expect(enqueue).not.toHaveBeenCalled()
    vi.mocked(commitBranchInfo).mockResolvedValue({ branch: 'feature', defaultBranch: 'main' })
    await push()
    await service.tick(120_000)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('follows only the newest push of a branch and ends with the thread', async () => {
    vi.mocked(commitChecks).mockResolvedValue(failing)
    await push()
    vi.mocked(headOid).mockResolvedValue('fff0000aaa')
    await push()
    service.stopForSession('session')
    await service.tick(0)
    expect(enqueue).not.toHaveBeenCalled()
    await push()
    await service.tick(60_000)
    expect(enqueue).toHaveBeenCalledOnce()
    expect(vi.mocked(commitChecks)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(commitChecks)).toHaveBeenCalledWith('/repo', 'fff0000aaa')
  })

  it('waits while the thread is paused and forgets services it cannot follow', async () => {
    vi.mocked(commitChecks).mockResolvedValue(failing)
    paused = true
    await push()
    await service.tick(0)
    expect(enqueue).not.toHaveBeenCalled()
    paused = false
    await service.tick(60_000)
    expect(enqueue).toHaveBeenCalledOnce()
    vi.mocked(commitChecks).mockResolvedValue(null)
    await push()
    await service.tick(120_000)
    await service.tick(180_000)
    expect(vi.mocked(commitChecks)).toHaveBeenCalledTimes(3)
    expect(enqueue).toHaveBeenCalledOnce()
  })
})
