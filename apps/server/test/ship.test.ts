import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionInfo, PullRequestInfo } from '@ramu/shared/types'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import type { AgentService } from '../src/agent'
import { ShipService, workingDayAfter } from '../src/background/ship'
import { currentBranch, git, headOid } from '../src/workspace/git'
import { pullRequestStatus } from '../src/workspace/forge'
import { committedShipConfig } from '../src/workspace/projectConfig'

vi.mock('../src/workspace/git', () => ({ currentBranch: vi.fn(), git: vi.fn(), headOid: vi.fn(), push: vi.fn() }))
vi.mock('../src/workspace/forge', () => ({ pullRequestStatus: vi.fn() }))
vi.mock('../src/workspace/projectConfig', () => ({ committedShipConfig: vi.fn() }))

let db: Db, ws: Workspace, ship: ShipService
let session: AgentSessionInfo
let pr: PullRequestInfo
let enqueue: ReturnType<typeof vi.fn>
let watched: Map<string, string | null>
let watch: ReturnType<
  typeof vi.fn<(cwd: string, repoId: string, url: string, sessionId: string | null) => Promise<void>>
>
let viewer: string | null, live: string | null

const texts = () => enqueue.mock.calls.map((call) => call[1] as string)
const checkout = { sessionId: 'session', cwd: '/repo', branch: 'fix', url: 'https://github.com/ana/shop/pull/7' }

beforeEach(() => {
  vi.resetAllMocks()
  db = openDb(':memory:')
  ws = new Workspace(db, '/tmp/ramu-ship-test')
  session = { id: 'session', taskId: 'task', state: 'idle', covers: ['/repo'], parentId: null } as AgentSessionInfo
  vi.spyOn(ws, 'getTask').mockReturnValue({ id: 'task', projectId: 'project', status: 'idle' } as ReturnType<
    Workspace['getTask']
  >)
  vi.spyOn(ws, 'listRepositories').mockReturnValue([{ id: 'repo', projectId: 'project', name: 'shop', root: '/repo' }])
  vi.spyOn(ws, 'listBindings').mockReturnValue([{ cwd: '/repo', repoId: 'repo' }] as ReturnType<
    Workspace['listBindings']
  >)
  enqueue = vi.fn()
  const agents = { get: () => session, enqueueBackground: enqueue } as unknown as AgentService
  watched = new Map()
  watch = vi.fn(async (_cwd: string, _repoId: string, url: string, sessionId: string | null) => {
    watched.set(url, sessionId)
  })
  viewer = 'ana'
  live = null
  ship = new ShipService(
    ws,
    agents,
    { watch, status: (_cwd, url) => ({ sessionId: watched.get(url) ?? null, threads: [] }) },
    { liveAddress: () => live, viewer: () => viewer },
    () => {},
  )
  pr = {
    number: 7,
    title: 'Fix',
    url: checkout.url,
    state: 'open',
    draft: false,
    baseBranch: 'main',
    headBranch: 'fix',
    reviewDecision: null,
    checks: [{ name: 'Build', state: 'pending', url: null }],
  }
  vi.mocked(git).mockResolvedValue('git@github.com:ana/shop.git\n')
  vi.mocked(currentBranch).mockResolvedValue('fix')
  vi.mocked(headOid).mockResolvedValue('sha0')
  vi.mocked(committedShipConfig).mockResolvedValue(null)
  vi.mocked(pullRequestStatus).mockImplementation(async () => ({
    availability: 'ready',
    pullRequest: structuredClone(pr),
  }))
})
afterEach(async () => {
  await ship.stop()
  db.close()
})

const poll = async () => {
  await ship.tick(Date.now() + 10 * 60_000 * (poll.count++ + 1))
}
poll.count = 0

describe('project finish line', () => {
  it('suggests going live for a personal repository with a live address, review for someone else’s', async () => {
    live = 'https://shop.example.com'
    expect((await ship.projectStatus('project')).finishLine).toBe('live')
    viewer = 'bob'
    expect((await ship.projectStatus('project')).finishLine).toBe('review')
  })

  it('holds the person’s choice to the limit committed on the default branch', async () => {
    ship.setProjectFinishLine('project', 'live')
    vi.mocked(committedShipConfig).mockResolvedValue({ finishLine: 'review', maxCiFixes: 1 })
    const status = await ship.projectStatus('project')
    expect(status).toMatchObject({ chosen: 'live', repositoryLimit: 'review', finishLine: 'review' })
    expect(status.limits).toEqual({ maxCiFixes: 1, maxReviewRounds: 5 })
  })

  it('lets an agent ask for an earlier finish line but never a later one', async () => {
    ship.setProjectFinishLine('project', 'review')
    expect((await ship.start('session', 'live')).finishLine).toBe('review')
    expect((await ship.start('session', 'pull-request')).finishLine).toBe('pull-request')
  })
})

describe('what Ship may do without asking', () => {
  it('follows the person’s choices, held to what the repository keeps with a person', async () => {
    expect((await ship.projectStatus('project')).options).toEqual({
      sendReplies: true,
      autoMerge: false,
      autoDeploy: true,
    })
    ship.setProjectOptions('project', { autoMerge: true })
    // The finish line chosen before stays when an option changes, and the other way round.
    ship.setProjectFinishLine('project', 'merged')
    expect(await ship.projectStatus('project')).toMatchObject({ chosen: 'merged', options: { autoMerge: true } })
    vi.mocked(committedShipConfig).mockResolvedValue({ autoMerge: false, sendReplies: false })
    expect(await ship.projectStatus('project')).toMatchObject({
      options: { sendReplies: false, autoMerge: false, autoDeploy: true },
      forbidden: ['sendReplies', 'autoMerge'],
    })
  })

  it('merges on its own only through the Git host’s auto-merge, when the project allows it and ships that far', async () => {
    ship.setProjectFinishLine('project', 'merged')
    await ship.start('session')
    expect(ship.mayDecide('session', 'auto-merge')).toBe(false)
    ship.setProjectOptions('project', { autoMerge: true })
    const { instructions } = await ship.start('session')
    expect(instructions).toMatch(/whenChecksPass: true/)
    expect(ship.mayDecide('session', 'auto-merge')).toBe(true)
    expect(ship.mayDecide('session', 'merge')).toBe(false)
    expect(ship.mayDecide('other', 'auto-merge')).toBe(false)
    // A run that stops at review never merges, whatever the switch says.
    await ship.start('session', 'review')
    expect(ship.mayDecide('session', 'auto-merge')).toBe(false)
  })

  it('deploys to production unasked only after the project’s first deploy was allowed', async () => {
    live = 'https://shop.example.com'
    await ship.start('session')
    expect(ship.mayDeploy('session')).toBe(false)
    ship.deployAllowed('session')
    expect((await ship.projectStatus('project')).deployedOnce).toBe(true)
    expect(ship.mayDeploy('session')).toBe(true)
    // Not for a run that stops before production, and not when the project turned it off.
    await ship.start('session', 'merged')
    expect(ship.mayDeploy('session')).toBe(false)
    ship.setProjectOptions('project', { autoDeploy: false })
    await ship.start('session')
    expect(ship.mayDeploy('session')).toBe(false)
  })

  it('posts a shipping thread’s fix replies between turns and lists them, and Undo deletes them', async () => {
    const sendFixedReplies = vi.fn(async () => [{ url: checkout.url, number: 7, commentIds: ['c1', 'c2'] }])
    const deleteReplies = vi.fn(async () => {})
    const agents = { get: () => session, enqueueBackground: enqueue } as unknown as AgentService
    ship = new ShipService(
      ws,
      agents,
      { watch, status: (_cwd, url) => ({ sessionId: watched.get(url) ?? null, threads: [] }) },
      { liveAddress: () => live, viewer: () => viewer, sendFixedReplies, deleteReplies },
      () => {},
    )
    await ship.start('session')
    // Not while the agent is still writing its round.
    session.state = 'running'
    await poll()
    expect(sendFixedReplies).not.toHaveBeenCalled()
    session.state = 'idle'
    await poll()
    expect(sendFixedReplies).toHaveBeenCalledWith('session')
    const [entry] = ship.activity()
    expect(entry).toMatchObject({ kind: 'replies-sent', number: 7, replies: 2 })
    await ship.undo(entry!.id)
    expect(deleteReplies).toHaveBeenCalledWith('session', checkout.url, ['c1', 'c2'])
    expect(ship.activity()[0]?.undoneAt).toBeTypeOf('number')
  })
})

describe('waiting on reviewers', () => {
  const green = () => {
    pr.checks = [{ name: 'Build', state: 'success', url: null }]
  }
  const shipWith = (waiting: () => unknown, proposeComment = vi.fn(async () => {})) => {
    const agents = { get: () => session, enqueueBackground: enqueue } as unknown as AgentService
    ship = new ShipService(
      ws,
      agents,
      { watch, status: (_cwd, url) => ({ sessionId: watched.get(url) ?? null, threads: [] }) },
      { liveAddress: () => live, viewer: () => viewer, waiting: waiting as never, proposeComment },
      () => {},
    )
    return proposeComment
  }
  const waitingOn = (from: string[]) => ({
    approvals: 1,
    from,
    codeOwner: false,
    conversations: 0,
    changesBy: [],
    queue: false,
  })

  it('has the agent offer reviewers once when nobody was asked, and spends no more turns after', async () => {
    green()
    shipWith(() => waitingOn([]))
    await ship.start('session', 'review')
    await poll()
    // The first look only notes that the wait began.
    expect(enqueue).not.toHaveBeenCalled()
    await poll()
    expect(texts()).toHaveLength(1)
    expect(texts()[0]).toMatch(/nobody has been asked to review/)
    expect(texts()[0]).toMatch(/pull_request_reviewers/)
    await poll()
    await poll()
    expect(texts()).toHaveLength(1)
  })

  it('drafts one reminder for the person after a working day, and never when reviewers answered', async () => {
    green()
    const propose = shipWith(() => waitingOn(['ana', 'payments-team']))
    await ship.start('session', 'review')
    const clock = vi.spyOn(Date, 'now')
    const monday = new Date('2026-11-23T09:00:00').getTime()
    clock.mockReturnValue(monday)
    await poll()
    clock.mockReturnValue(monday + 6 * 60 * 60_000)
    await poll()
    expect(propose).not.toHaveBeenCalled()
    clock.mockReturnValue(monday + 25 * 60 * 60_000)
    await poll()
    expect(propose).toHaveBeenCalledExactlyOnceWith(
      'session',
      checkout.url,
      '@ana @payments-team this is ready for review when you have a moment. Thanks!',
    )
    clock.mockReturnValue(monday + 80 * 60 * 60_000)
    await poll()
    expect(propose).toHaveBeenCalledOnce()
    // The agent was never woken for it.
    expect(enqueue).not.toHaveBeenCalled()
    clock.mockRestore()
  })

  it('offers once to ask a reviewer again when their approval no longer stands', async () => {
    green()
    shipWith(() => ({ ...waitingOn(['bo']), dismissed: ['ana', 'bo'] }))
    await ship.start('session', 'review')
    await poll()
    await poll()
    await poll()
    // Bo is already asked again; only Ana is offered.
    expect(texts()).toHaveLength(1)
    expect(texts()[0]).toMatch(/approval from @ana no longer stands/)
    expect(texts()[0]).toMatch(/pull_request_reviewers/)
  })

  it('does not count a weekend as a working day', () => {
    const friday = new Date('2026-11-27T16:00:00')
    const due = new Date(workingDayAfter(friday.getTime()))
    expect(due.getDay()).toBe(1)
    const tuesday = new Date('2026-11-24T10:00:00')
    expect(new Date(workingDayAfter(tuesday.getTime())).getDay()).toBe(3)
  })
})

describe('rounds', () => {
  it('tells the agent to push check fixes and asks the person once the limit is spent', async () => {
    vi.mocked(committedShipConfig).mockResolvedValue({ maxCiFixes: 2 })
    await ship.start('session')
    for (let round = 0; round < 2; round++) {
      expect(ship.before(checkout, 'checks')).toMatch(/push it/)
      ship.after(checkout, 'checks')
    }
    expect(ship.before(checkout, 'checks')).toBe(false)
    expect(ship.held('session', 'checks')).toBe(true)
    expect(ship.before(checkout, 'checks')).toBe(false)
    expect(texts()).toHaveLength(1)
    expect(texts()[0]).toMatch(/ask_user/)
    // Review rounds have their own limit.
    // Review rounds have their own limit; replies that report a fix go out without the person.
    expect(ship.before(checkout, 'reviews')).toMatch(/Ramu pushes the branch and posts those replies/)
    ship.moreRounds('session')
    expect(ship.held('session', 'checks')).toBe(false)
    expect(ship.before(checkout, 'checks')).toMatch(/push it/)
  })

  it('leaves threads that are not shipping to the watch as before', () => {
    expect(ship.before(checkout, 'checks')).toBeNull()
  })
})

describe('following the pull request', () => {
  it('watches the pull request once it opens and stops at an approved one for review', async () => {
    ship.setProjectFinishLine('project', 'review')
    await ship.start('session')
    await poll()
    expect(watch).toHaveBeenCalledWith('/repo', 'repo', pr.url, 'session')
    expect(texts()).toEqual([])
    pr.checks = [{ name: 'Build', state: 'success', url: null }]
    pr.reviewDecision = 'approved'
    await poll()
    expect(texts()).toHaveLength(1)
    expect(texts()[0]).toMatch(/reached the finish line/)
    expect(ship.shipping('session')).toBeNull()
    // Finishing ends the watch Ship started.
    expect(watched.get(pr.url)).toBeNull()
  })

  it('asks for the merge once, then the deploy after it, when the line is live', async () => {
    ship.setProjectFinishLine('project', 'live')
    live = 'https://shop.example.com'
    await ship.start('session')
    pr.checks = [{ name: 'Build', state: 'success', url: null }]
    pr.reviewDecision = 'approved'
    await poll()
    await poll()
    expect(texts()).toHaveLength(1)
    expect(texts()[0]).toMatch(/pull_request_merge/)
    pr.state = 'merged'
    await poll()
    expect(texts()[1]).toMatch(/deploy to production/)
    expect(ship.shipping('session')).toBeNull()
  })

  it('waits for checks to register before calling a new pull request finished', async () => {
    ship.setProjectFinishLine('project', 'pull-request')
    await ship.start('session')
    pr.checks = []
    await ship.tick(Date.now() + 1)
    expect(texts()).toEqual([])
    vi.useFakeTimers({ now: Date.now() + 6 * 60_000 })
    try {
      await ship.tick(Date.now() + 60 * 60_000)
    } finally {
      vi.useRealTimers()
    }
    expect(texts()[0]).toMatch(/reached the finish line/)
  })

  it('keeps a watch the person gave another thread', async () => {
    await ship.start('session')
    watched.set(pr.url, 'other')
    await poll()
    expect(watch).not.toHaveBeenCalled()
  })
})

describe('limits the agent cannot lift', () => {
  it('allows more rounds only once a limit is spent, and keeps spent rounds when shipping starts again', async () => {
    vi.mocked(committedShipConfig).mockResolvedValue({ maxCiFixes: 1 })
    await ship.start('session')
    expect(() => ship.moreRounds('session')).toThrow(/No round limit is spent/)
    ship.after(checkout, 'checks')
    await ship.start('session')
    expect(ship.before(checkout, 'checks')).toBe(false)
    expect(ship.held('session', 'checks')).toBe(true)
    await ship.start('session')
    expect(ship.held('session', 'checks')).toBe(true)
  })
})

it('ignores a pull request merged before shipping began on a reused branch', async () => {
  pr.state = 'merged'
  await ship.start('session')
  await poll()
  expect(texts()).toEqual([])
  expect(ship.shipping('session')).not.toBeNull()
})
