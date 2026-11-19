import { expect, it } from 'vitest'
import { timelineEvent } from '../src/workspace/forge/githubTimeline'

it('reads commits, reviews, comments, review requests and state changes, and skips what it does not show', () => {
  expect(
    timelineEvent({
      __typename: 'PullRequestCommit',
      url: 'https://github.com/o/r/pull/1/commits/abc',
      commit: {
        messageHeadline: 'Fix the export',
        committedDate: '2026-11-08T10:00:00Z',
        author: { user: { login: 'ana' } },
      },
    }),
  ).toEqual({
    kind: 'commit',
    actor: 'ana',
    at: Date.parse('2026-11-08T10:00:00Z'),
    text: 'Fix the export',
    url: 'https://github.com/o/r/pull/1/commits/abc',
  })
  expect(
    timelineEvent({
      __typename: 'PullRequestReview',
      state: 'CHANGES_REQUESTED',
      submittedAt: '2026-11-08T11:00:00Z',
      author: { login: 'bo' },
      body: '\n\nPlease rename it.\nAnd add a test.',
    }),
  ).toMatchObject({ kind: 'review', actor: 'bo', verdict: 'changes-requested', text: 'Please rename it.' })
  // A review still being written has no submission time and stays out.
  expect(timelineEvent({ __typename: 'PullRequestReview', state: 'PENDING', author: { login: 'bo' } })).toBeNull()
  expect(
    timelineEvent({
      __typename: 'IssueComment',
      createdAt: '2026-11-08T12:00:00Z',
      author: null,
      body: 'x'.repeat(300),
    })?.text,
  ).toHaveLength(200)
  expect(
    timelineEvent({
      __typename: 'ReviewRequestedEvent',
      createdAt: '2026-11-08T09:00:00Z',
      actor: { login: 'ana' },
      requestedReviewer: { slug: 'core' },
    }),
  ).toMatchObject({ kind: 'review-requested', text: 'core' })
  expect(
    timelineEvent({ __typename: 'MergedEvent', createdAt: '2026-11-08T13:00:00Z', actor: { login: 'ana' } }),
  ).toMatchObject({ kind: 'merged', actor: 'ana' })
  expect(timelineEvent({ __typename: 'LabeledEvent' })).toBeNull()
})
