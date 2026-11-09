import { describe, expect, it } from 'vitest'
import type { PullRequestSummary } from '../src/types'
import { READINESS_ACTION, readinessRows, readinessStep, reviewVerdicts } from '../src/pullRequestReadiness'

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

describe('pull request readiness', () => {
  it('reads checks, reviews, merging and conversations in that order', () => {
    expect(readinessRows(pr(), 0).map((row) => [row.key, row.tone, row.text])).toEqual([
      ['checks', 'ok', 'All checks passed'],
      ['review', 'muted', 'Waiting on review'],
      ['merge', 'ok', 'No conflicts with its base branch'],
      ['conversations', 'ok', 'All conversations resolved'],
    ])
  })

  it('names what blocks it and who was asked to review', () => {
    const rows = readinessRows(pr({ checks: 'failure', mergeable: 'conflicts', requestedReviewers: ['bo', 'cy'] }), 2)
    expect(rows[0]).toMatchObject({ tone: 'bad', text: 'Checks failing' })
    expect(rows[1]).toMatchObject({ text: 'Review requested from {0}', values: { 0: 'bo, cy' } })
    expect(rows[2]).toMatchObject({ tone: 'bad', text: 'Has conflicts with its base branch' })
    expect(rows[3]).toMatchObject({ tone: 'warn', values: { 0: 2 } })
  })

  it('holds back the steps that need a checkout for a repository in no project', () => {
    for (const step of ['review', 'fix-checks', 'address-comments', 'resolve-conflicts'] as const) {
      expect(readinessStep(step, true)).toBe('none')
      expect(readinessStep(step, false)).toBe(step)
    }
    expect(readinessStep('merge', true)).toBe('merge')
    expect(readinessStep('update-branch', true)).toBe('update-branch')
    expect(READINESS_ACTION.merge).toBe('Merge…')
  })

  it('lets a review approve or request changes only on someone else’s pull request, where the service can', () => {
    expect(reviewVerdicts('github', false)).toEqual(['comment', 'approve', 'request-changes'])
    expect(reviewVerdicts('github', true)).toEqual(['comment'])
    expect(reviewVerdicts('gitlab', false)).toEqual(['comment', 'approve'])
  })
})
