import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionInfo, PullRequestInfo } from '@ramu/shared/types'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import type { AgentService } from '../src/agent'
import { PullRequestWatchService } from '../src/background/pullRequestWatches'
import { currentBranch } from '../src/workspace/git'
import { pullRequestFeedback, pullRequestStatus } from '../src/workspace/forge'

vi.mock('../src/workspace/git', () => ({ currentBranch: vi.fn() }))
vi.mock('../src/workspace/forge', () => ({
  pullRequestFeedback: vi.fn(),
  pullRequestStatus: vi.fn(),
  resolvedConnectionId: vi.fn(async () => null),
}))

let db: Db, ws: Workspace, service: PullRequestWatchService
let session: AgentSessionInfo
let archived: boolean, paused: boolean, gone: boolean
let pr: PullRequestInfo
let enqueue: ReturnType<typeof vi.fn>
let agents: AgentService
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

  it('wakes on requested changes and on changed review feedback, without repeating unchanged reviews', async () => {
    pr.checks = []
    pr.reviewDecision = 'changes-requested'
    await watch()
    await service.tick(0)
    await service.tick(60_000)
    pr.headCommit = 'sha2'
    await service.tick(120_000)
    expect(enqueue).toHaveBeenCalledTimes(1)
    vi.mocked(pullRequestFeedback).mockResolvedValue('A new review comment')
    await service.tick(180_000)
    expect(enqueue).toHaveBeenCalledTimes(2)
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
})
