import { describe, expect, it } from 'vitest'
import type { PullRequestSummary, RepositoryPullRequests } from '../src/types'
import { translate } from '../src/i18n'
import {
  diffLineMatches,
  dismissedApprovals,
  pullRequestRowDetail,
  pullRequestWaiting,
  pullRequestWaitingDetail,
  pullRequestWaitingLine,
  groupPullRequests,
  inPullRequestFilter,
  matchesPullRequest,
  matchesPullRequestFile,
  matchesPullRequestRow,
  matchesReviewThread,
  mergedPullRequestRows,
  outsideRepoId,
  outsideRepository,
  pullRequestGlyph,
  pullRequestMergeOffer,
  pullRequestRows,
  shownReviewThreads,
  pullRequestRef,
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

describe('the Pull requests page across hosts', () => {
  const repo = (overrides: Partial<RepositoryPullRequests>): RepositoryPullRequests => ({
    projectId: 'p',
    projectName: 'Bakery',
    repoId: 'r',
    repoName: 'site',
    availability: 'ready',
    viewer: 'ana',
    pullRequests: [pr({ url: 'u/1', number: 1, updatedAt: 2 })],
    local: {},
    ...overrides,
  })

  it('lists a pull request once when several hosts have its repository', () => {
    const rows = mergedPullRequestRows([
      { host: 'laptop', repositories: [repo({})] },
      {
        host: 'vps',
        repositories: [repo({ repoId: 'r2', pullRequests: [pr({ url: 'u/1' }), pr({ url: 'u/2', updatedAt: 9 })] })],
      },
    ])
    expect(rows.map((row) => [row.pr.url, row.host, row.sources.map((source) => source.host)])).toEqual([
      ['u/2', 'vps', ['vps']],
      ['u/1', 'laptop', ['laptop', 'vps']],
    ])
  })

  it('opens it where a thread works on it, else on the host on screen', () => {
    const working = repo({ threads: { 'u/1': [{ taskId: 't', title: 'Fix' }] } })
    expect(
      mergedPullRequestRows(
        [
          { host: 'laptop', repositories: [repo({})] },
          { host: 'vps', repositories: [working] },
        ],
        ['laptop'],
      )[0],
    ).toMatchObject({ host: 'vps', repoId: 'r' })
    expect(
      mergedPullRequestRows(
        [
          { host: 'laptop', repositories: [repo({})] },
          { host: 'vps', repositories: [repo({})] },
        ],
        ['vps'],
      )[0]?.host,
    ).toBe('vps')
  })

  it('prefers a host with a checkout over one that only lists it from the service', () => {
    const rows = mergedPullRequestRows([
      { host: 'laptop', repositories: [repo({ outside: true })] },
      { host: 'vps', repositories: [repo({})] },
    ])
    expect(rows[0]).toMatchObject({ host: 'vps', outside: false })
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

describe('hosting services on the Pull requests page', () => {
  const base = {
    projectId: 'p',
    projectName: 'Shop',
    repoId: 'r',
    availability: 'ready' as const,
    viewer: 'me',
    local: {},
  }
  const rows = pullRequestRows([
    { ...base, repoName: 'web', pullRequests: [pr({ url: 'u/1', number: 1 })] },
    { ...base, repoId: 'g', repoName: 'api', service: 'gitlab', pullRequests: [pr({ url: 'u/2', number: 2 })] },
  ])

  it("carries each row's service, GitHub when the list names none", () => {
    expect(rows.map((row) => row.service).sort()).toEqual(['github', 'gitlab'])
  })

  it('writes numbers the way each service does', () => {
    expect(pullRequestRef('github', 4)).toBe('#4')
    expect(pullRequestRef('bitbucket', 4)).toBe('#4')
    expect(pullRequestRef('gitlab', 4)).toBe('!4')
    expect(pullRequestRef('azure', 4)).toBe('!4')
  })

  it('finds rows by their service name', () => {
    expect(rows.filter((row) => matchesPullRequestRow(row, 'gitlab')).map((row) => row.pr.number)).toEqual([2])
  })
})

describe('reading a pull request file diff', () => {
  it('numbers each line on the side it belongs to, from the hunk headers', async () => {
    const { patchRows } = await import('../src/pullRequests')
    const rows = patchRows(
      '@@ -10,3 +10,4 @@ fn\n keep\n-old\n+new\n+added\n\\ No newline at end of file\n@@ -40 +41 @@\n tail',
    )
    expect(rows.map((row) => [row.kind, row.old ?? null, row.new ?? null])).toEqual([
      ['hunk', null, null],
      ['context', 10, 10],
      ['del', 11, null],
      ['add', null, 11],
      ['add', null, 12],
      ['note', null, null],
      ['hunk', null, null],
      ['context', 40, 41],
    ])
    expect(rows[2]!.text).toBe('old')
  })
})

describe('the next step on a pull request', () => {
  it("offers the fix on one's own pull request and the review on someone else's", async () => {
    const { pullRequestNextStep } = await import('../src/pullRequests')
    const step = (overrides: Partial<PullRequestSummary>, mine: boolean) => {
      const value = pr(overrides)
      return pullRequestNextStep(value, pullRequestStage(value), mine)
    }
    expect(step({ reviewDecision: 'approved' }, true)).toBe('merge')
    expect(step({ checks: 'failure' }, true)).toBe('fix-checks')
    expect(step({ checks: 'failure' }, false)).toBe('review')
    expect(step({ mergeable: 'conflicts' }, true)).toBe('resolve-conflicts')
    expect(step({ reviewDecision: 'changes-requested' }, true)).toBe('address-comments')
    expect(step({ draft: true }, true)).toBe('mark-ready')
    expect(step({ checks: 'pending' }, false)).toBe('wait-checks')
    expect(step({ mergeable: 'behind' }, true)).toBe('update-branch')
    expect(step({}, false)).toBe('review')
    expect(step({}, true)).toBe('wait-review')
    expect(step({ state: 'merged' }, true)).toBe('none')
  })
})

describe('repositories in no project', () => {
  it('names a GitHub repository by its owner and name, and refuses anything else', () => {
    expect(outsideRepository(outsideRepoId('friend/site.io'))).toBe('friend/site.io')
    expect(outsideRepository(`outside:${'a'.repeat(39)}/${'b'.repeat(100)}`)).toBe(
      `${'a'.repeat(39)}/${'b'.repeat(100)}`,
    )
    for (const bad of ['repo-1', 'outside:friend', 'outside:friend/site/extra', 'outside:../site', 'outside:friend/..'])
      expect(outsideRepository(bad)).toBeNull()
    expect(outsideRepository(`outside:${'a'.repeat(40)}/site`)).toBeNull()
  })
})

describe('shownReviewThreads', () => {
  const thread = (id: string, resolved: boolean, at: number) => ({
    id,
    path: null,
    line: null,
    outdated: false,
    resolved,
    resolvable: true,
    comments: [{ id: `${id}c`, author: null, bot: false, trusted: true, body: '', createdAt: at }],
  })
  const threads = [thread('a', false, 1), thread('b', true, 3), thread('c', false, 2)]

  it('shows unresolved, resolved or every thread, by its latest comment', () => {
    expect(shownReviewThreads(threads, 'open', 'newest').map((entry) => entry.id)).toEqual(['c', 'a'])
    expect(shownReviewThreads(threads, 'resolved', 'newest').map((entry) => entry.id)).toEqual(['b'])
    expect(shownReviewThreads(threads, 'all', 'oldest').map((entry) => entry.id)).toEqual(['a', 'c', 'b'])
  })

  it('leaves the list it was given in its order', () => {
    shownReviewThreads(threads, 'all', 'newest')
    expect(threads.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('searching inside a pull request', () => {
  const thread = {
    id: 't',
    path: 'src/auth/login.ts',
    line: 4,
    outdated: false,
    resolved: false,
    resolvable: true,
    comments: [
      { id: '1', author: 'ana', bot: false, trusted: true, body: 'Rename this token', createdAt: 1 },
      { id: '2', author: 'bo', bot: false, trusted: true, body: 'Done', createdAt: 2 },
    ],
  }

  it('finds a review thread by its file, an author or any comment', () => {
    expect(matchesReviewThread(thread, '')).toBe(true)
    expect(matchesReviewThread(thread, 'login')).toBe(true)
    expect(matchesReviewThread(thread, 'BO token')).toBe(true)
    expect(matchesReviewThread(thread, 'token cy')).toBe(false)
    expect(shownReviewThreads([thread], 'all', 'newest', 'missing')).toEqual([])
  })

  it('finds a changed file by its path, its old path or its diff, and marks the lines that matched', () => {
    const file = {
      path: 'src/new.ts',
      previousPath: 'src/old.ts',
      patch: '@@ -1 +1 @@\n-const a = 1\n+const tokenTtl = 2',
    }
    expect(matchesPullRequestFile(file, 'new.ts')).toBe(true)
    expect(matchesPullRequestFile(file, 'old.ts')).toBe(true)
    expect(matchesPullRequestFile(file, 'TOKENTTL')).toBe(true)
    expect(matchesPullRequestFile({ ...file, patch: null }, 'tokenttl')).toBe(false)
    expect(diffLineMatches('const tokenTtl = 2', 'tokenttl')).toBe(true)
    expect(diffLineMatches('const a = 1', 'tokenttl')).toBe(false)
    expect(diffLineMatches('anything', ' ')).toBe(false)
  })
})

describe('pullRequestRowDetail', () => {
  const t = (key: string, values?: Record<string, string | number>) => translate('en', key, values)
  it('leads with what an agent prepared, otherwise the stage', () => {
    expect(
      pullRequestRowDetail({ number: 42, stage: 'replies-ready', prepared: { kind: 'replies', count: 3 } }, t),
    ).toBe('#42 · 3 replies drafted')
    expect(
      pullRequestRowDetail({ number: 42, stage: 'replies-ready', prepared: { kind: 'replies', count: 1 } }, t),
    ).toBe('#42 · 1 reply drafted')
    expect(pullRequestRowDetail({ number: 7, stage: 'replies-ready', prepared: { kind: 'review' } }, t)).toBe(
      '#7 · Review drafted',
    )
    expect(pullRequestRowDetail({ number: 7, stage: 'ready' }, t)).toBe('#7 · Ready to merge')
    expect(
      pullRequestRowDetail(
        { number: 7, stage: 'replies-ready', prepared: { kind: 'replies', count: 3 } },
        (key, values) => translate('id', key, values),
      ),
    ).toBe('#7 · 3 balasan sudah didraf')
  })
})

describe('what a pull request waits on people for', () => {
  const t = (key: string, values?: Record<string, string | number>) => translate('en', key, values)
  const open = {
    state: 'open' as const,
    reviewDecision: 'review-required' as const,
    openThreads: 0,
    requestedReviewers: ['payments-team'],
    approvedBy: ['ana'],
    changesRequestedBy: [],
  }
  const line = (pr: Parameters<typeof pullRequestWaiting>[0], rules?: Parameters<typeof pullRequestWaiting>[1]) => {
    const waiting = pullRequestWaiting(pr, rules)
    return waiting && pullRequestWaitingLine(waiting, t)
  }

  it('counts the approvals still missing when the branch’s rules say how many', () => {
    expect(line(open, { approvals: 2 })).toBe('needs 1 more approval from @payments-team')
    expect(line({ ...open, approvedBy: [] }, { approvals: 2 })).toBe('needs 2 more approvals from @payments-team')
  })

  it('names the code owner as the one missing once the count is met', () => {
    expect(line({ ...open, approvedBy: ['ana', 'bo'] }, { approvals: 2, codeOwners: true })).toBe(
      'needs a code owner’s approval from @payments-team',
    )
  })

  it('says only what the service says when the rules are not readable', () => {
    expect(line(open)).toBe('waiting on review from @payments-team')
    expect(line({ ...open, requestedReviewers: [] })).toBe('no reviewer asked yet')
  })

  it('counts conversations only where the repository requires them resolved', () => {
    const approved = { ...open, reviewDecision: 'approved' as const, openThreads: 2 }
    expect(line(approved, { conversations: true })).toBe('2 conversations to resolve')
    // Open conversations a repository does not require resolved hold nothing up.
    expect(pullRequestWaiting(approved, {})).toBeNull()
    expect(line({ ...open, openThreads: 1 }, { approvals: 2, conversations: true })).toBe(
      'needs 1 more approval from @payments-team · 1 conversation to resolve',
    )
  })

  it('says who requested changes', () => {
    expect(line({ ...open, reviewDecision: 'changes-requested', changesRequestedBy: ['bo'] })).toBe(
      'changes requested by @bo',
    )
  })

  it('waits on nobody once approved, merged or closed', () => {
    expect(pullRequestWaiting({ ...open, reviewDecision: 'approved' }, { approvals: 1 })).toBeNull()
    expect(pullRequestWaiting({ ...open, state: 'merged' })).toBeNull()
  })

  it('gives the reason as a line beside the stage only while the stage is a wait on people', () => {
    const waiting = pullRequestWaiting(open, { approvals: 2 })!
    expect(pullRequestWaitingDetail('review-required', waiting, t)).toBe('needs 1 more approval from @payments-team')
    expect(pullRequestWaitingDetail('checks-failing', waiting, t)).toBeNull()
    expect(pullRequestWaitingDetail('review-required', undefined, t)).toBeNull()
  })

  it('shows the reason on the row in place of the stage’s own words', () => {
    const waiting = pullRequestWaiting(open, { approvals: 2 })!
    expect(pullRequestRowDetail({ number: 42, stage: 'review-required', waiting }, t)).toBe(
      '#42 · needs 1 more approval from @payments-team',
    )
    // A stage that is the person's or the agent's keeps its own words.
    expect(pullRequestRowDetail({ number: 42, stage: 'checks-failing', waiting }, t)).toBe('#42 · Checks failing')
    expect(pullRequestRowDetail({ number: 42, stage: 'review-required' }, t)).toBe('#42 · Waiting on review')
  })
})

describe('pullRequestMergeOffer', () => {
  const pr = (extra: Partial<PullRequestSummary> = {}) =>
    ({ state: 'open', draft: false, mergeable: 'clean', ...extra }) as PullRequestSummary
  const waiting = { approvals: 1, from: [], codeOwner: false, conversations: 0, changesBy: [], queue: false }

  it('offers Merge when the service says it can merge', () => {
    expect(pullRequestMergeOffer(pr(), true)).toBe('now')
    // A request for changes that the repository does not enforce does not hold the merge.
    expect(pullRequestMergeOffer(pr({ waiting: { ...waiting, approvals: 0, changesBy: ['ana'] } }), false)).toBe('now')
  })

  it('leaves a held pull request to the service’s own automatic merge, or offers nothing without one', () => {
    expect(pullRequestMergeOffer(pr({ mergeable: 'blocked' }), true)).toBe('when-ready')
    expect(pullRequestMergeOffer(pr({ mergeable: 'behind' }), false)).toBe('none')
  })

  it('goes by the missing approval where the service gives no verdict', () => {
    expect(pullRequestMergeOffer(pr({ mergeable: 'unknown' }), false)).toBe('now')
    expect(pullRequestMergeOffer(pr({ mergeable: 'unknown', waiting }), false)).toBe('none')
  })

  it('offers nothing on a draft, a conflict or a pull request no longer open', () => {
    expect(pullRequestMergeOffer(pr({ draft: true }), true)).toBe('none')
    expect(pullRequestMergeOffer(pr({ mergeable: 'conflicts' }), true)).toBe('none')
    expect(pullRequestMergeOffer(pr({ state: 'merged' }), true)).toBe('none')
  })
})

describe('dismissed approvals', () => {
  it('names who approved before and no longer does, until they answer again', () => {
    expect(dismissedApprovals({ approvedBy: ['ana', 'bo'] }, { approvedBy: ['bo'] })).toEqual(['ana'])
    expect(dismissedApprovals({ dismissed: ['ana'] }, { approvedBy: [] })).toEqual(['ana'])
    expect(dismissedApprovals({ dismissed: ['ana'] }, { approvedBy: ['Ana'] })).toEqual([])
    expect(dismissedApprovals({ approvedBy: ['ana'] }, { approvedBy: [], changesRequestedBy: ['ana'] })).toEqual([])
    // A look that does not list approvals says nothing new.
    expect(dismissedApprovals({ approvedBy: ['ana'], dismissed: ['bo'] }, {})).toEqual(['bo'])
  })

  it('says so in the waiting line', () => {
    const waiting = { approvals: 1, from: [], codeOwner: false, conversations: 0, changesBy: [], queue: false }
    const say = (key: string, values?: Record<string, string | number>) => translate('en', key, values)
    expect(pullRequestWaitingLine({ ...waiting, dismissed: ['ana'] }, say)).toBe(
      'needs 1 more approval · @ana’s approval no longer stands',
    )
  })
})
