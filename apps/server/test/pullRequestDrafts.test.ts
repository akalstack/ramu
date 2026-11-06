import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionInfo, PullRequestThread } from '@ramu/shared/types'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import type { AgentService } from '../src/agent'
import { PullRequestDrafts } from '../src/background/pullRequestDrafts'
import { currentBranch, push } from '../src/workspace/git'
import { pullRequestStatus, replyToThread, requestReviews, resolveThread, reviewThreads } from '../src/workspace/forge'

vi.mock('../src/workspace/git', () => ({ currentBranch: vi.fn(), push: vi.fn() }))
vi.mock('../src/workspace/forge', () => ({
  pullRequestStatus: vi.fn(),
  replyToThread: vi.fn(),
  requestReviews: vi.fn(),
  resolveThread: vi.fn(),
  reviewThreads: vi.fn(),
  submitReview: vi.fn(),
}))

const URL = 'https://github.com/o/r/pull/7'
let db: Db, ws: Workspace, drafts: PullRequestDrafts
let threads: PullRequestThread[]
const order: string[] = []

const thread = (id: string, author = 'ana'): PullRequestThread => ({
  id,
  path: 'src/a.ts',
  line: 1,
  outdated: false,
  resolved: false,
  resolvable: true,
  comments: [{ id: `${id}-c`, author, bot: false, trusted: true, body: 'Please rename', createdAt: 1 }],
})

beforeEach(() => {
  vi.resetAllMocks()
  order.length = 0
  db = openDb(':memory:')
  ws = new Workspace(db, '/tmp/ramu-pr-drafts-test')
  vi.spyOn(ws, 'getBinding').mockReturnValue({ cwd: '/repo' } as ReturnType<Workspace['getBinding']>)
  const session = { id: 'session', taskId: 'task', state: 'idle', covers: ['/repo'] } as AgentSessionInfo
  const agents = { get: () => session, list: () => [session] } as unknown as AgentService
  drafts = new PullRequestDrafts(
    ws,
    agents,
    () => {},
    () => 'me',
  )
  threads = [thread('t1'), thread('t2', 'bo')]
  vi.mocked(currentBranch).mockResolvedValue('fix')
  vi.mocked(pullRequestStatus).mockResolvedValue({
    availability: 'ready',
    pullRequest: { state: 'open', url: URL } as never,
  })
  vi.mocked(reviewThreads).mockImplementation(async () => structuredClone(threads))
  vi.mocked(push).mockImplementation(async () => {
    order.push('push')
  })
  vi.mocked(replyToThread).mockImplementation(async (_cwd, _url, threadId) => {
    order.push(`reply:${threadId}`)
    return `posted-${threadId}`
  })
  vi.mocked(resolveThread).mockResolvedValue()
  vi.mocked(requestReviews).mockImplementation(async (_cwd, _url, reviewers) => {
    order.push(`review:${reviewers.join(',')}`)
  })
})
afterEach(() => db.close())

function round() {
  const batch = drafts.begin({
    url: URL,
    number: 7,
    repoId: 'repo',
    branch: 'fix',
    sessionId: 'session',
    threads,
    reviewers: drafts.reviewersOf('repo', threads),
  })
  return {
    ...batch,
    drafts: [
      { threadId: 't1', outcome: 'fixed' as const, reply: 'Renamed it.', commit: 'abc1234' },
      { threadId: 't2', outcome: 'skipped' as const, reply: '', commit: null },
    ],
  }
}

describe('drafted review replies', () => {
  it('pushes before posting, links the fix commit, skips skipped threads and asks reviewers again', async () => {
    const batch = round()
    ws.setAppState('pull-request-drafts', [batch])
    const result = await drafts.sendReplies(batch.id, {
      push: true,
      resolveFixed: true,
      requestReview: true,
      edits: [],
    })
    expect(order).toEqual(['push', 'reply:t1', 'review:ana,bo'])
    expect(vi.mocked(replyToThread).mock.calls[0]![3]).toBe('Renamed it.\n\nFixed in abc1234.')
    expect(resolveThread).toHaveBeenCalledWith('/repo', URL, 't1')
    expect(result).toEqual({ pushed: true, posted: 1, failed: [] })
    expect(drafts.get(URL)).toBeNull()
  })

  it('posts nothing when the push fails', async () => {
    const batch = round()
    ws.setAppState('pull-request-drafts', [batch])
    vi.mocked(push).mockRejectedValue(new Error('rejected'))
    await expect(
      drafts.sendReplies(batch.id, { push: true, resolveFixed: false, requestReview: true, edits: [] }),
    ).rejects.toThrow('rejected')
    expect(replyToThread).not.toHaveBeenCalled()
    expect(drafts.get(URL)?.id).toBe(batch.id)
  })

  it('never posts a reply twice: a retry skips what reached the thread before a lost answer', async () => {
    const batch = round()
    ws.setAppState('pull-request-drafts', [batch])
    threads[0]!.comments.push({
      id: 'already',
      author: 'me',
      bot: false,
      trusted: true,
      body: 'Renamed it.\n\nFixed in abc1234.',
      createdAt: Date.now() + 1,
    })
    const result = await drafts.sendReplies(batch.id, {
      push: false,
      resolveFixed: false,
      requestReview: false,
      edits: [],
    })
    expect(replyToThread).not.toHaveBeenCalled()
    expect(result.posted).toBe(1)
  })

  it('keeps a failed reply with its error for a retry, and sends the person’s edits', async () => {
    const batch = round()
    ws.setAppState('pull-request-drafts', [batch])
    vi.mocked(replyToThread).mockRejectedValueOnce(new Error('HTTP 502'))
    const result = await drafts.sendReplies(batch.id, {
      push: false,
      resolveFixed: false,
      requestReview: true,
      edits: [{ threadId: 't2', outcome: 'question', reply: 'Which name do you prefer?' }],
    })
    expect(result.failed).toEqual([{ threadId: 't1', error: 'HTTP 502' }])
    expect(order).toEqual(['reply:t2'])
    const kept = drafts.get(URL)
    expect(kept?.kind === 'replies' && kept.drafts.find((draft) => draft.threadId === 't1')?.error).toBe('HTTP 502')
    expect(kept?.kind === 'replies' && kept.drafts.find((draft) => draft.threadId === 't2')?.postedId).toBe('posted-t2')
  })

  it('refuses to send from another branch', async () => {
    const batch = round()
    ws.setAppState('pull-request-drafts', [batch])
    vi.mocked(currentBranch).mockResolvedValue('main')
    await expect(
      drafts.sendReplies(batch.id, { push: true, resolveFixed: false, requestReview: false, edits: [] }),
    ).rejects.toThrow('Switch back to fix')
    expect(push).not.toHaveBeenCalled()
  })

  it('asks for review again only from trusted people other than the person', () => {
    threads.push({
      ...thread('t3', 'me'),
    })
    expect(drafts.reviewersOf('repo', threads)).toEqual(['ana', 'bo'])
  })

  it('keeps the person’s edits on the host and lets a later round keep unsent drafts', () => {
    const batch = round()
    ws.setAppState('pull-request-drafts', [batch])
    drafts.edit(batch.id, { kind: 'replies', edits: [{ threadId: 't2', outcome: 'question', reply: ' Which name? ' }] })
    const edited = drafts.get(URL)
    expect(edited?.kind === 'replies' && edited.drafts.find((draft) => draft.threadId === 't2')).toMatchObject({
      outcome: 'question',
      reply: 'Which name?',
    })
    const next = drafts.begin({
      url: URL,
      number: 7,
      repoId: 'repo',
      branch: 'fix',
      sessionId: 'session',
      threads: [threads[1]!],
      reviewers: [],
    })
    expect(next.id).toBe(batch.id)
    expect(next.drafts.map((draft) => draft.threadId)).toEqual(['t2'])
    expect(next.threads.map((thread) => thread.id)).toEqual(['t2'])
  })
})
