import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentSessionInfo } from '@ramu/shared/types'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import type { AgentService } from '../src/agent'
import { PullRequestWrites, isDecision, undoOf, unsupportedWrite } from '../src/background/pullRequestWrites'
import * as forge from '../src/workspace/forge'
import { git } from '../src/workspace/git'

vi.mock('../src/workspace/git', () => ({ git: vi.fn() }))
vi.mock('../src/workspace/forge', () => ({
  listPullRequests: vi.fn(),
  pullRequestStatus: vi.fn(),
  serviceOf: vi.fn(),
  repositoryAccount: vi.fn(),
  commentOnPullRequest: vi.fn(),
  deleteComment: vi.fn(),
  submitReview: vi.fn(),
  setThreadStatus: vi.fn(),
}))

const URL = 'https://github.com/o/r/pull/7'
let db: Db, ws: Workspace, writes: PullRequestWrites
let session: AgentSessionInfo
let events: AgentEvent[]
const guard = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  db = openDb(':memory:')
  ws = new Workspace(db, '/tmp/ramu-pr-writes-test')
  const binding = { cwd: '/repo', repoId: 'repo', repoName: 'r' }
  vi.spyOn(ws, 'listBindings').mockReturnValue([binding] as ReturnType<Workspace['listBindings']>)
  vi.spyOn(ws, 'getBinding').mockReturnValue(binding as ReturnType<Workspace['getBinding']>)
  session = {
    id: 'session',
    taskId: 'task',
    covers: ['/repo'],
    settings: { access: 'auto' },
  } as unknown as AgentSessionInfo
  events = [{ kind: 'user', text: 'approve it and say thanks', at: 1 }]
  const agents = {
    get: () => session,
    events: () => events,
    pullRequestWritesShown: (_id: string, cardId: string) => events.push({ kind: 'pull-request-writes', cardId }),
  } as unknown as AgentService
  writes = new PullRequestWrites(ws, agents, () => {}, guard)
  vi.mocked(git).mockResolvedValue('origin\tgit@github.com:o/r.git (push)\n')
  vi.mocked(forge.serviceOf).mockResolvedValue('github')
  vi.mocked(forge.repositoryAccount).mockResolvedValue({
    origin: 'github.com',
    login: 'me',
    source: 'cli',
    ambiguous: false,
  })
  vi.mocked(forge.pullRequestStatus).mockResolvedValue({
    availability: 'ready',
    pullRequest: { number: 7, title: 'Fix', url: URL, state: 'open' } as never,
  })
  vi.mocked(forge.commentOnPullRequest).mockResolvedValue('IC_1')
})
afterEach(() => db.close())

it('keeps writes from one turn in one card and posts nothing until the person posts', async () => {
  const approval = await writes.request('session', URL, { kind: 'review', verdict: 'approve', body: '', comments: [] })
  vi.mocked(forge.listPullRequests).mockResolvedValue({
    availability: 'ready',
    viewer: 'me',
    pullRequests: [{ number: 7, url: URL } as never],
  })
  const thanks = await writes.request('session', '#7', { kind: 'comment', body: 'Thanks!' })
  expect(approval.state).toBe('waiting')
  expect(thanks.cardId).toBe(approval.cardId)
  expect(events.filter((event) => event.kind === 'pull-request-writes')).toHaveLength(1)
  expect(forge.submitReview).not.toHaveBeenCalled()
  expect(forge.commentOnPullRequest).not.toHaveBeenCalled()
  const card = await writes.post(approval.cardId)
  expect(guard).toHaveBeenCalledWith('task', '/repo', 'Posting on this pull request')
  expect(card.items.map((item) => item.state)).toEqual(['posted', 'posted'])
  // A second Post never sends what already went out.
  await writes.post(approval.cardId)
  expect(forge.commentOnPullRequest).toHaveBeenCalledTimes(1)
})

it('posts conversation writes at once in Full access and offers Undo, but approvals still wait', async () => {
  session.settings.access = 'full'
  const reply = await writes.request('session', URL, { kind: 'comment', body: 'Fixed in the last commit.' })
  const approval = await writes.request('session', URL, { kind: 'review', verdict: 'approve', body: '', comments: [] })
  expect(reply.state).toBe('posted')
  expect(approval.state).toBe('waiting')
  const card = writes.get(reply.cardId)!
  const posted = card.items.find((item) => item.state === 'posted')!
  expect(posted.undoable).toBe(true)
  const undone = await writes.undo(card.id, posted.id)
  expect(forge.deleteComment).toHaveBeenCalledWith('/repo', URL, 'IC_1')
  expect(undone.items.find((item) => item.id === posted.id)?.state).toBe('undone')
})

it('posts nothing when the identity check stops it', async () => {
  const { cardId } = await writes.request('session', URL, { kind: 'comment', body: 'Hello' })
  guard.mockRejectedValueOnce(new Error('Posting would act as Personal'))
  await expect(writes.post(cardId)).rejects.toThrow(/Personal/)
  expect(forge.commentOnPullRequest).not.toHaveBeenCalled()
  expect(writes.get(cardId)!.items[0]!.state).toBe('waiting')
})

it('keeps a failed write in the card with its error', async () => {
  vi.mocked(forge.commentOnPullRequest).mockRejectedValueOnce(new Error('Locked conversation'))
  const { cardId } = await writes.request('session', URL, { kind: 'comment', body: 'Hello' })
  const card = await writes.post(cardId)
  expect(card.items[0]).toMatchObject({ state: 'failed', error: 'Locked conversation' })
})

it('refuses what a service lacks in words the agent can repeat', async () => {
  expect(unsupportedWrite('bitbucket', { kind: 'update', update: { labels: { add: ['bug'], remove: [] } } })).toBe(
    'Bitbucket has no labels.',
  )
  expect(unsupportedWrite('azure', { kind: 'react', commentId: '1/2', reaction: 'heart', remove: false })).toMatch(
    /thumbs-up/,
  )
  expect(unsupportedWrite('github', { kind: 'comment', body: 'x' })).toBeNull()
  vi.mocked(forge.serviceOf).mockResolvedValue('bitbucket')
  vi.mocked(git).mockResolvedValue('origin\tgit@bitbucket.org:o/r.git (push)\n')
  await expect(
    writes.request('session', 'https://bitbucket.org/o/r/pull-requests/7', {
      kind: 'update',
      update: { labels: { add: ['bug'], remove: [] } },
    }),
  ).rejects.toThrow('Bitbucket has no labels.')
})

it('treats approvals, merges, closing and base changes as decisions, and knows how to take writes back', () => {
  expect(isDecision({ kind: 'review', verdict: 'approve', body: '', comments: [] })).toBe(true)
  expect(isDecision({ kind: 'review', verdict: 'comment', body: '', comments: [] })).toBe(false)
  expect(isDecision({ kind: 'action', action: { kind: 'merge', method: 'squash', deleteBranch: true } })).toBe(true)
  expect(isDecision({ kind: 'action', action: { kind: 'ready' } })).toBe(false)
  expect(isDecision({ kind: 'update', update: { base: 'main' } })).toBe(true)
  expect(isDecision({ kind: 'update', update: { title: 'New' } })).toBe(false)
  const item = { id: 'i', decision: false, state: 'posted' as const, at: 0 }
  expect(undoOf({ ...item, write: { kind: 'thread-status', threadId: 't', status: 'resolved' } })).toEqual({
    kind: 'thread-status',
    threadId: 't',
    status: 'active',
  })
  expect(undoOf({ ...item, write: { kind: 'reviewers', add: ['bob'], remove: [] } })).toEqual({
    kind: 'reviewers',
    add: [],
    remove: ['bob'],
  })
  expect(undoOf({ ...item, write: { kind: 'action', action: { kind: 'ready' } } })).toBeNull()
})
