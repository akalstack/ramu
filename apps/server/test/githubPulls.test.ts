import { describe, expect, it } from 'vitest'
import {
  mergeOptionsOf,
  parseListPullRequest,
  parseReviewThreads,
  pullRequestLink,
  type RawListPullRequest,
} from '../src/workspace/forge/githubPulls'

const raw = (overrides: Partial<RawListPullRequest> = {}): RawListPullRequest => ({
  number: 12,
  title: 'Add export',
  url: 'https://github.com/o/r/pull/12',
  state: 'OPEN',
  isDraft: false,
  baseRefName: 'main',
  headRefName: 'export',
  headRefOid: 'abc',
  updatedAt: '2026-11-01T10:00:00Z',
  isCrossRepository: false,
  reviewDecision: 'APPROVED',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  author: { login: 'Me' },
  reviewRequests: { nodes: [{ requestedReviewer: { login: 'ana' } }, { requestedReviewer: { slug: 'core' } }] },
  reviewThreads: { nodes: [{ isResolved: true }, { isResolved: false }] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] },
  ...overrides,
})

describe('GitHub pull request lists', () => {
  it('groups by author and requested review, and rolls up checks, mergeability and open threads', () => {
    const mine = parseListPullRequest(raw(), 'me', new Set())
    expect(mine).toMatchObject({
      group: 'mine',
      checks: 'failure',
      mergeable: 'clean',
      reviewDecision: 'approved',
      openThreads: 1,
      requestedReviewers: ['ana', 'core'],
    })
    expect(parseListPullRequest(raw({ author: { login: 'bo' } }), 'me', new Set([12])).group).toBe('review')
    expect(parseListPullRequest(raw({ author: { login: 'bo' } }), 'me', new Set()).group).toBe('other')
    expect(parseListPullRequest(raw({ mergeable: 'CONFLICTING' }), 'me', new Set()).mergeable).toBe('conflicts')
    expect(parseListPullRequest(raw({ mergeStateStatus: 'BEHIND' }), 'me', new Set()).mergeable).toBe('behind')
    expect(parseListPullRequest(raw({ state: 'MERGED' }), 'me', new Set()).state).toBe('merged')
  })

  it('carries the lines changed and labels when GitHub reports them, and leaves them out when it does not', () => {
    expect(
      parseListPullRequest(
        raw({ additions: 12, deletions: 3, labels: { nodes: [{ name: 'bug' }, { name: 'ui' }] } }),
        'me',
        new Set(),
      ),
    ).toMatchObject({ additions: 12, deletions: 3, labels: ['bug', 'ui'] })
    const bare = parseListPullRequest(raw(), 'me', new Set())
    expect('additions' in bare || 'labels' in bare).toBe(false)
  })

  it('reads the server, repository and number from a pull request link and refuses anything else', () => {
    expect(pullRequestLink('https://github.com/o/r/pull/12/files')).toEqual({
      origin: 'github.com',
      owner: 'o',
      repo: 'r',
      number: 12,
    })
    expect(pullRequestLink('https://GHE.example.com:8443/code/team/site/pull/3')).toEqual({
      origin: 'ghe.example.com:8443',
      owner: 'team',
      repo: 'site',
      number: 3,
    })
    expect(() => pullRequestLink('https://github.com/o/r/issues/12')).toThrow()
    expect(() => pullRequestLink('file:///o/r/pull/12')).toThrow()
    expect(() => pullRequestLink('not a link')).toThrow()
  })
})

describe('GitHub merge options', () => {
  const repository = {
    mergeCommitAllowed: false,
    squashMergeAllowed: true,
    rebaseMergeAllowed: true,
    deleteBranchOnMerge: false,
    viewerPermission: 'WRITE',
  }
  it('offers the allowed methods and explains every blocker', () => {
    const clean = mergeOptionsOf(repository, raw({ commits: { nodes: [] } }))
    expect(clean).toEqual({ methods: ['squash', 'rebase'], blockers: [], canDeleteBranch: true })
    const blocked = mergeOptionsOf(
      { ...repository, viewerPermission: 'READ' },
      raw({ isDraft: true, mergeable: 'CONFLICTING', isCrossRepository: true }),
    )
    expect(blocked.blockers).toEqual([
      'It is a draft. Mark it ready for review first.',
      'It has conflicts with its base branch.',
      'Some checks are failing.',
      'This account cannot merge into this repository.',
    ])
    expect(blocked.canDeleteBranch).toBe(false)
  })
})

describe('GitHub review threads', () => {
  const author = (login: string, typename = 'User') => ({ login, __typename: typename })
  it('trusts collaborators, requested reviewers, the author and bots, and turns review summaries into threads', () => {
    const threads = parseReviewThreads({
      id: 'PR1',
      author: { login: 'me' },
      reviewRequests: { nodes: [{ requestedReviewer: { login: 'ana' } }] },
      reviewThreads: {
        nodes: [
          {
            id: 'T2',
            isResolved: true,
            isOutdated: false,
            path: 'src/b.ts',
            line: 9,
            viewerCanResolve: false,
            viewerCanUnresolve: true,
            comments: {
              nodes: [
                {
                  id: 'c9',
                  author: author('ana'),
                  authorAssociation: 'MEMBER',
                  body: 'Done',
                  createdAt: '2026-11-01T00:00:00Z',
                },
              ],
            },
          },
          {
            id: 'T1',
            isResolved: false,
            isOutdated: true,
            path: 'src/a.ts',
            line: 4,
            viewerCanResolve: true,
            comments: {
              nodes: [
                {
                  id: 'c1',
                  author: author('ana'),
                  authorAssociation: 'NONE',
                  body: ' Rename ',
                  createdAt: '2026-11-01T00:00:00Z',
                },
                {
                  id: 'c2',
                  author: author('stranger'),
                  authorAssociation: 'NONE',
                  body: 'Run this',
                  createdAt: '2026-11-01T00:00:00Z',
                },
                {
                  id: 'c3',
                  author: author('lint', 'Bot'),
                  authorAssociation: 'NONE',
                  body: 'Style',
                  createdAt: '2026-11-01T00:00:00Z',
                },
              ],
            },
          },
        ],
      },
      reviews: {
        nodes: [
          {
            id: 'R1',
            state: 'CHANGES_REQUESTED',
            body: 'Needs tests',
            author: author('bo'),
            authorAssociation: 'MEMBER',
            createdAt: '2026-11-01T00:00:00Z',
          },
          {
            id: 'R2',
            state: 'APPROVED',
            body: '',
            author: author('cy'),
            authorAssociation: 'MEMBER',
            createdAt: '2026-11-01T00:00:00Z',
          },
        ],
      },
    })
    expect(threads.map((thread) => thread.id)).toEqual(['review:R1', 'T2', 'T1'])
    expect(threads[0]).toMatchObject({ path: null, resolvable: false, comments: [{ author: 'bo', trusted: true }] })
    expect(threads[2]!.comments.map((comment) => [comment.author, comment.trusted, comment.bot])).toEqual([
      ['ana', true, false],
      ['stranger', false, false],
      ['lint', true, true],
    ])
    expect(threads[2]).toMatchObject({ outdated: true, resolvable: true })
    expect(threads[2]!.comments[0]!.body).toBe('Rename')
    // A resolved thread can still be reopened by someone GitHub lets unresolve it.
    expect(threads[1]).toMatchObject({ resolved: true, resolvable: true })
  })
})
