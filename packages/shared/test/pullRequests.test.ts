import { describe, expect, it } from 'vitest'
import type { PullRequestSummary, RepositoryPullRequests } from '../src/types'
import {
  groupPullRequests,
  inPullRequestFilter,
  matchesPullRequest,
  matchesPullRequestRow,
  pullRequestGlyph,
  pullRequestRows,
  pullRequestStage,
  sortPullRequestRows,
} from '../src/pullRequests'

const pr = (overrides: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
  number: 4,
  title: 'Add CSV export',
  url: 'https://example.com/pull/4',
  state: 'open',
  draft: false,
  baseBranch: 'main',
  headBranch: 'csv-export',
  author: 'ana',
  fork: false,
  reviewDecision: null,
  checks: 'success',
  mergeable: 'clean',
  openThreads: 0,
  requestedReviewers: [],
  group: 'mine',
  updatedAt: 1,
  ...overrides,
})

describe('pull request stage', () => {
  it('names the most pressing thing first', () => {
    expect(pullRequestStage(pr({ mergeable: 'conflicts', checks: 'failure' }))).toBe('conflicts')
    expect(pullRequestStage(pr({ checks: 'failure', reviewDecision: 'changes-requested' }))).toBe('checks-failing')
    expect(pullRequestStage(pr({ reviewDecision: 'changes-requested', draft: true }))).toBe('changes-requested')
    expect(pullRequestStage(pr({ draft: true, checks: 'pending' }))).toBe('draft')
    expect(pullRequestStage(pr({ checks: 'pending' }))).toBe('checks-pending')
    expect(pullRequestStage(pr())).toBe('review-required')
    expect(pullRequestStage(pr({ reviewDecision: 'approved' }))).toBe('ready')
    expect(pullRequestStage(pr({ reviewDecision: 'approved', openThreads: 2 }))).toBe('review-required')
    expect(pullRequestStage(pr({ reviewDecision: 'approved', mergeable: 'blocked' }))).toBe('review-required')
  })

  it('puts Ramu’s own state ahead of the service’s, but never over a finished pull request', () => {
    expect(pullRequestStage(pr({ checks: 'failure' }), { draftsReady: true })).toBe('replies-ready')
    expect(pullRequestStage(pr(), { agentWorking: true })).toBe('agent-working')
    expect(pullRequestStage(pr({ state: 'merged' }), { draftsReady: true })).toBe('merged')
    expect(pullRequestStage(pr({ state: 'closed' }))).toBe('closed')
  })

  it('uses the hosting services’ shapes', () => {
    expect(pullRequestGlyph(pr({ draft: true }))).toBe('draft')
    expect(pullRequestGlyph(pr({ state: 'merged', draft: true }))).toBe('merged')
    expect(pullRequestGlyph(pr({ state: 'closed' }))).toBe('closed')
    expect(pullRequestGlyph(pr())).toBe('open')
  })
})

describe('pull request lists', () => {
  it('groups yours, review requested and the rest, newest first, leaving empty groups out', () => {
    const rows = [
      pr({ url: 'a', group: 'other', updatedAt: 1 }),
      pr({ url: 'b', group: 'mine', updatedAt: 1 }),
      pr({ url: 'c', group: 'mine', updatedAt: 3 }),
    ]
    expect(groupPullRequests(rows).map(({ group, rows: items }) => [group, items.map((row) => row.url)])).toEqual([
      ['mine', ['c', 'b']],
      ['other', ['a']],
    ])
  })

  it('matches a search on number, title, author and branch', () => {
    expect(matchesPullRequest(pr(), '#4')).toBe(true)
    expect(matchesPullRequest(pr(), 'csv ana')).toBe(true)
    expect(matchesPullRequest(pr(), 'export bo')).toBe(false)
    expect(matchesPullRequest(pr(), '  ')).toBe(true)
  })
})

describe('the Pull requests page', () => {
  const repo = (overrides: Partial<RepositoryPullRequests>): RepositoryPullRequests => ({
    projectId: 'p',
    projectName: 'Bakery',
    repoId: 'r',
    repoName: 'site',
    availability: 'ready',
    viewer: 'ana',
    pullRequests: [],
    local: {},
    ...overrides,
  })
  const rows = pullRequestRows([
    repo({
      pullRequests: [
        pr({ url: 'u/1', number: 1, updatedAt: 1, reviewDecision: 'approved' }),
        pr({ url: 'u/2', number: 2, updatedAt: 5 }),
        pr({ url: 'u/3', number: 3, updatedAt: 3, group: 'review', author: 'bo' }),
      ],
      local: { 'u/2': { draftsReady: true } },
      threads: { 'u/2': [{ taskId: 't', title: 'CSV' }] },
    }),
    repo({
      projectName: 'Shop',
      repoName: 'api',
      pullRequests: [pr({ url: 'u/4', number: 4, updatedAt: 4, state: 'merged' }), pr({ url: 'u/5', group: 'other' })],
    }),
  ])

  it('joins every repository newest first, with Ramu’s own stage and threads', () => {
    expect(rows.map((row) => row.pr.number)).toEqual([2, 4, 3, 1, 4])
    expect(rows[0]).toMatchObject({ stage: 'replies-ready', threads: [{ taskId: 't', title: 'CSV' }] })
  })

  it('puts reviews asked of you and your own pull requests waiting on you under Needs you', () => {
    const numbers = (filter: Parameters<typeof inPullRequestFilter>[1]) =>
      rows.filter((row) => inPullRequestFilter(row, filter)).map((row) => row.pr.number)
    expect(numbers('needs-you')).toEqual([2, 3, 1])
    expect(numbers('review')).toEqual([3])
    expect(numbers('closed')).toEqual([4])
    expect(numbers('open')).toHaveLength(4)
  })

  it('finds a row by its project or repository', () => {
    expect(rows.filter((row) => matchesPullRequestRow(row, 'shop api'))).toHaveLength(2)
  })
})

describe('sorting the Pull requests page', () => {
  const row = (stage: ReturnType<typeof pullRequestStage>, updatedAt: number) => ({ pr: pr({ updatedAt }), stage })
  const rows = [row('checks-failing', 9), row('ready', 1), row('draft', 5), row('ready', 3), row('checks-pending', 7)]

  it('puts the ones closest to merging first, newest first within a stage', () => {
    expect(sortPullRequestRows(rows, 'readiness').map((entry) => [entry.stage, entry.pr.updatedAt])).toEqual([
      ['ready', 3],
      ['ready', 1],
      ['checks-pending', 7],
      ['checks-failing', 9],
      ['draft', 5],
    ])
  })

  it('or simply by the most recent change', () => {
    expect(sortPullRequestRows(rows, 'updated').map((entry) => entry.pr.updatedAt)).toEqual([9, 7, 5, 3, 1])
  })
})
