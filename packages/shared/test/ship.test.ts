import { describe, expect, it } from 'vitest'
import type { PullRequestInfo } from '../src/types'
import { translate } from '../src/i18n'
import {
  shipActivityText,
  defaultFinishLine,
  earlierFinishLine,
  reachableFinishLines,
  shipExplanation,
  shipStep,
} from '../src/ship'

const pr = (overrides: Partial<PullRequestInfo> = {}): PullRequestInfo => ({
  number: 7,
  title: 'Fix login',
  url: 'https://github.com/o/r/pull/7',
  state: 'open',
  draft: false,
  baseBranch: 'main',
  headBranch: 'fix-login',
  reviewDecision: null,
  checks: [{ name: 'Build', state: 'success', url: null }],
  ...overrides,
})

describe('finish lines', () => {
  it('lets a repository only stop the loop earlier', () => {
    expect(earlierFinishLine('live', 'review')).toBe('review')
    expect(earlierFinishLine('pull-request', 'live')).toBe('pull-request')
    expect(earlierFinishLine('merged', null)).toBe('merged')
  })

  it('starts a team repository at review and a personal one as far as Ramu can check', () => {
    expect(defaultFinishLine({ onGitHost: true, personal: false, liveAddress: true })).toBe('review')
    expect(defaultFinishLine({ onGitHost: true, personal: true, liveAddress: true })).toBe('live')
    expect(defaultFinishLine({ onGitHost: true, personal: true, liveAddress: false })).toBe('merged')
    expect(defaultFinishLine({ onGitHost: false, personal: true, liveAddress: true })).toBe('pull-request')
  })
})

describe('shipStep', () => {
  it('keeps working while checks fail or run, or the pull request is a draft', () => {
    expect(shipStep(pr({ checks: [{ name: 'Build', state: 'failure', url: null }] }), 'pull-request')).toBe('working')
    expect(shipStep(pr({ checks: [{ name: 'Build', state: 'pending', url: null }] }), 'pull-request')).toBe('working')
    expect(shipStep(pr({ draft: true }), 'pull-request')).toBe('working')
  })

  it('reaches a pull request finish line once its checks pass, without waiting for review', () => {
    expect(shipStep(pr(), 'pull-request')).toBe('reached')
    expect(shipStep(pr({ checks: [] }), 'pull-request')).toBe('reached')
  })

  it('waits for approval before review counts as reached', () => {
    expect(shipStep(pr({ reviewDecision: 'changes-requested' }), 'review')).toBe('working')
    expect(shipStep(pr({ reviewDecision: 'approved' }), 'review')).toBe('reached')
  })

  it('hands an approved pull request to the person to merge when the line is past review', () => {
    expect(shipStep(pr({ reviewDecision: 'approved' }), 'merged')).toBe('merge')
    expect(shipStep(pr({ reviewDecision: 'approved' }), 'live')).toBe('merge')
  })

  it('deploys after a merge only when the line goes past it', () => {
    expect(shipStep(pr({ state: 'merged' }), 'merged')).toBe('reached')
    expect(shipStep(pr({ state: 'merged' }), 'review')).toBe('reached')
    expect(shipStep(pr({ state: 'merged' }), 'preview')).toBe('deploy')
    expect(shipStep(pr({ state: 'closed' }), 'live')).toBe('closed')
  })
})

describe('what a project shows', () => {
  const status = {
    chosen: null,
    suggested: 'live' as const,
    repositoryLimit: 'review' as const,
    finishLine: 'review' as const,
    limits: { maxCiFixes: 2, maxReviewRounds: 5 },
  }

  it('offers only the finish lines the repository allows', () => {
    expect(reachableFinishLines(status)).toEqual(['pull-request', 'review'])
    expect(reachableFinishLines({ repositoryLimit: null })).toHaveLength(5)
  })

  it('explains shipping in the person’s language, with the repository’s limit', () => {
    expect(shipExplanation(status, (key, values) => translate('en', key, values))).toEqual([
      'Ask an agent to ship and it fixes failing checks and handles review rounds on its own, up to 2 and 5 rounds, then stops at Ready for review. Approving, merging and production deploys still ask you.',
      'This repository’s ramu.json stops shipping at Ready for review.',
    ])
    expect(shipExplanation(status, (key, values) => translate('id', key, values))[1]).toBe(
      'ramu.json repositori ini menghentikan ship di Siap ditinjau.',
    )
  })
})

it('says what Ship did unasked, and that it was undone', () => {
  const t = (key: string, values?: Record<string, string | number>) => translate('en', key, values)
  const entry = { number: 42, from: 'aaaaaaa111', to: 'bbbbbbb222' }
  expect(shipActivityText(entry, t)).toEqual({
    title: 'Fixed failing checks on #42',
    detail: 'Pushed aaaaaaa..bbbbbbb',
  })
  expect(shipActivityText({ ...entry, number: null, undoneAt: 1 }, t)).toEqual({
    title: 'Fixed failing checks',
    detail: 'Undone with a revert',
  })
})
