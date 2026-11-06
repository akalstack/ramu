import { describe, expect, it } from 'vitest'
import type { PullRequestSummary } from '../src/types'
import { groupPullRequests, matchesPullRequest, pullRequestGlyph, pullRequestStage } from '../src/pullRequests'

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
