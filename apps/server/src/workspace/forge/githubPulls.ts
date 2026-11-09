// GitHub pull request lists, actions, review threads and replies. Reads and writes go through `githubGraphql` and
// `githubRest`, so the signed-in `gh` and a saved token behave the same.
import type {
  MergeMethod,
  MergeOptions,
  PullRequestAction,
  PullRequestChecksState,
  PullRequestList,
  PullRequestMergeability,
  PullRequestReviewDecision,
  PullRequestSummary,
  ReviewCommentDraft,
  PullRequestThread,
  ReviewVerdict,
} from '@ramu/shared/types'
import { ForgeError, forgeRemoteOf, githubAvailability, githubGraphql, githubRest } from './github'

const PR_FRAGMENT = `fragment pr on PullRequest {
  id number title url state isDraft baseRefName headRefName headRefOid updatedAt isCrossRepository
  reviewDecision mergeable mergeStateStatus additions deletions
  labels(first: 10) { nodes { name } }
  author { login }
  reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { slug } } } }
  reviewThreads(first: 100) { nodes { isResolved } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`

export interface RawListPullRequest {
  id?: string
  number: number
  title: string
  url: string
  state: string
  isDraft: boolean
  baseRefName: string
  headRefName: string
  headRefOid?: string
  updatedAt: string
  isCrossRepository: boolean
  reviewDecision?: string | null
  mergeable?: string | null
  mergeStateStatus?: string | null
  additions?: number
  deletions?: number
  labels?: { nodes: { name: string }[] }
  author: { login: string } | null
  reviewRequests?: { nodes: { requestedReviewer: { login?: string; slug?: string } | null }[] }
  reviewThreads?: { nodes: { isResolved: boolean }[] }
  commits?: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] }
}

interface RawList {
  viewer: { login: string }
  open: { nodes: (RawListPullRequest | Record<string, never>)[] }
  closed?: { nodes: (RawListPullRequest | Record<string, never>)[] }
  review: { nodes: ({ number: number } | Record<string, never>)[] }
}

const LIST_QUERY = `query($open: String!, $closed: String!, $review: String!, $withClosed: Boolean!) {
  viewer { login }
  open: search(query: $open, type: ISSUE, first: 50) { nodes { ...pr } }
  closed: search(query: $closed, type: ISSUE, first: 30) @include(if: $withClosed) { nodes { ...pr } }
  review: search(query: $review, type: ISSUE, first: 50) { nodes { ... on PullRequest { number } } }
}
${PR_FRAGMENT}`

const DECISION: Record<string, PullRequestReviewDecision> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes-requested',
  REVIEW_REQUIRED: 'review-required',
}

function rollupState(state: string | undefined | null): PullRequestChecksState {
  switch (state?.toUpperCase()) {
    case 'SUCCESS':
      return 'success'
    case 'FAILURE':
    case 'ERROR':
      return 'failure'
    case 'PENDING':
    case 'EXPECTED':
      return 'pending'
    default:
      return null
  }
}

function mergeability(raw: Pick<RawListPullRequest, 'mergeable' | 'mergeStateStatus'>): PullRequestMergeability {
  if (raw.mergeable === 'CONFLICTING' || raw.mergeStateStatus === 'DIRTY') return 'conflicts'
  switch (raw.mergeStateStatus) {
    case 'BEHIND':
      return 'behind'
    case 'BLOCKED':
      return 'blocked'
    case 'CLEAN':
    case 'HAS_HOOKS':
    case 'UNSTABLE':
      return 'clean'
    default:
      return 'unknown'
  }
}

/** One search result as a list row. Results that are issues (empty objects in a PullRequest fragment) are skipped. */
export function parseListPullRequest(
  raw: RawListPullRequest,
  viewer: string,
  reviewNumbers: Set<number>,
): PullRequestSummary {
  const state = raw.state.toUpperCase()
  const author = raw.author?.login ?? null
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    state: state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : 'open',
    draft: raw.isDraft,
    baseBranch: raw.baseRefName,
    headBranch: raw.headRefName,
    ...(raw.headRefOid ? { headCommit: raw.headRefOid } : {}),
    author,
    fork: raw.isCrossRepository,
    reviewDecision: DECISION[raw.reviewDecision ?? ''] ?? null,
    checks: rollupState(raw.commits?.nodes[0]?.commit.statusCheckRollup?.state),
    mergeable: mergeability(raw),
    openThreads: raw.reviewThreads ? raw.reviewThreads.nodes.filter((thread) => !thread.isResolved).length : null,
    requestedReviewers: (raw.reviewRequests?.nodes ?? [])
      .map((node) => node.requestedReviewer?.login ?? node.requestedReviewer?.slug ?? '')
      .filter(Boolean),
    group:
      author && author.toLowerCase() === viewer.toLowerCase()
        ? 'mine'
        : reviewNumbers.has(raw.number)
          ? 'review'
          : 'other',
    updatedAt: Date.parse(raw.updatedAt) || 0,
    ...(typeof raw.additions === 'number' ? { additions: raw.additions } : {}),
    ...(typeof raw.deletions === 'number' ? { deletions: raw.deletions } : {}),
    ...(raw.labels?.nodes.length ? { labels: raw.labels.nodes.map((label) => label.name) } : {}),
  }
}

interface RawInvolved {
  viewer: { login: string }
  involved: { nodes: ((RawListPullRequest & { repository: { nameWithOwner: string } }) | Record<string, never>)[] }
  review: { nodes: ({ url: string } | Record<string, never>)[] }
}

const INVOLVED_QUERY = `query {
  viewer { login }
  involved: search(query: "is:pr is:open involves:@me archived:false sort:updated-desc", type: ISSUE, first: 50) {
    nodes { ...pr ... on PullRequest { repository { nameWithOwner } } }
  }
  review: search(query: "is:pr is:open review-requested:@me archived:false", type: ISSUE, first: 50) {
    nodes { ... on PullRequest { url } }
  }
}
${PR_FRAGMENT}`

/**
 * Open pull requests anywhere on GitHub that involve the account this checkout signs in with (authored, assigned,
 * mentioned or asked to review), each with the repository it belongs to; empty when GitHub is not available here.
 */
export async function listInvolvedPullRequests(
  cwd: string,
): Promise<{ viewer: string; repository: string; pr: PullRequestSummary }[]> {
  if ((await githubAvailability(cwd)) !== 'ready') return []
  const raw = await githubGraphql<RawInvolved>(cwd, INVOLVED_QUERY, {})
  const viewer = raw.viewer.login
  const review = new Set(raw.review.nodes.filter((node) => 'url' in node).map((node) => node.url))
  type Involved = RawListPullRequest & { repository: { nameWithOwner: string } }
  return raw.involved.nodes
    .filter((node): node is Involved => isPull(node))
    .map((node) => {
      const pr = parseListPullRequest(node, viewer, new Set())
      return {
        viewer,
        repository: node.repository.nameWithOwner,
        pr: pr.group === 'mine' || !review.has(pr.url) ? pr : { ...pr, group: 'review' as const },
      }
    })
}

const isPull = (node: RawListPullRequest | Record<string, never>): node is RawListPullRequest =>
  typeof (node as RawListPullRequest).number === 'number' && typeof (node as RawListPullRequest).url === 'string'

async function repository(cwd: string) {
  const remote = await forgeRemoteOf(cwd)
  if (!remote) throw new ForgeError('This checkout has no GitHub remote.', 'no-remote')
  return remote
}

/** Open pull requests (and, when asked, the latest closed and merged ones) of the checkout's repository. */
export async function listPullRequests(cwd: string, options: { includeClosed: boolean }): Promise<PullRequestList> {
  const availability = await githubAvailability(cwd)
  if (availability !== 'ready') return { availability, viewer: null, pullRequests: [] }
  const { owner, repo } = await repository(cwd)
  const scope = `repo:${owner}/${repo} is:pr`
  let raw: RawList
  try {
    raw = await githubGraphql<RawList>(cwd, LIST_QUERY, {
      open: `${scope} is:open sort:updated-desc`,
      closed: `${scope} is:closed sort:updated-desc`,
      review: `${scope} is:open review-requested:@me`,
      withClosed: options.includeClosed,
    })
  } catch (error) {
    if (error instanceof ForgeError && error.availability)
      return { availability: error.availability, viewer: null, pullRequests: [] }
    throw error
  }
  const viewer = raw.viewer.login
  const review = new Set(raw.review.nodes.filter((node) => 'number' in node).map((node) => node.number))
  const seen = new Set<number>()
  const pullRequests = [...raw.open.nodes, ...(raw.closed?.nodes ?? [])]
    .filter(isPull)
    .filter((node) => !seen.has(node.number) && seen.add(node.number))
    .map((node) => parseListPullRequest(node, viewer, review))
  return { availability, viewer, pullRequests }
}

export function pullNumber(url: string): number {
  const match = /\/pull\/(\d+)(?:[/?#]|$)/.exec(url)
  if (!match) throw new Error('That is not a GitHub pull request link.')
  return Number(match[1])
}

interface RawOne {
  repository: {
    mergeCommitAllowed: boolean
    squashMergeAllowed: boolean
    rebaseMergeAllowed: boolean
    deleteBranchOnMerge: boolean
    viewerPermission: string | null
    pullRequest: (RawListPullRequest & { id: string; body: string }) | null
  }
}

const ONE_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed deleteBranchOnMerge viewerPermission
    pullRequest(number: $number) { ...pr body }
  }
}
${PR_FRAGMENT}`

async function readOne(cwd: string, url: string) {
  const { owner, repo } = await repository(cwd)
  const number = pullNumber(url)
  const raw = await githubGraphql<RawOne>(cwd, ONE_QUERY, { owner, repo, number })
  const pr = raw.repository.pullRequest
  if (!pr) throw new Error(`Pull request #${number} was not found with this account.`)
  return { owner, repo, number, repository: raw.repository, pr }
}

/** What a merge needs and allows, explained in sentences the merge dialog shows as they are. */
export function mergeOptionsOf(raw: Omit<RawOne['repository'], 'pullRequest'>, pr: RawListPullRequest): MergeOptions {
  const methods: MergeMethod[] = [
    ...(raw.squashMergeAllowed ? (['squash'] as const) : []),
    ...(raw.mergeCommitAllowed ? (['merge'] as const) : []),
    ...(raw.rebaseMergeAllowed ? (['rebase'] as const) : []),
  ]
  const blockers: string[] = []
  const state = pr.state.toUpperCase()
  if (state !== 'OPEN') blockers.push('This pull request is not open.')
  if (pr.isDraft) blockers.push('It is a draft. Mark it ready for review first.')
  const merge = mergeability(pr)
  if (merge === 'conflicts') blockers.push('It has conflicts with its base branch.')
  if (merge === 'behind') blockers.push('It is behind its base branch, which this repository requires to be current.')
  if (merge === 'blocked') blockers.push('Branch protection is blocking it: required reviews or checks are missing.')
  if (rollupState(pr.commits?.nodes[0]?.commit.statusCheckRollup?.state) === 'failure' && merge !== 'blocked')
    blockers.push('Some checks are failing.')
  if (raw.viewerPermission && !['ADMIN', 'MAINTAIN', 'WRITE'].includes(raw.viewerPermission))
    blockers.push('This account cannot merge into this repository.')
  if (!methods.length) blockers.push('This repository allows no merge method.')
  return { methods, blockers, canDeleteBranch: !pr.isCrossRepository && !raw.deleteBranchOnMerge }
}

export async function mergeOptions(cwd: string, url: string): Promise<MergeOptions> {
  const { repository: raw, pr } = await readOne(cwd, url)
  return mergeOptionsOf(raw, pr)
}

const MERGE_METHOD: Record<MergeMethod, string> = { merge: 'MERGE', squash: 'SQUASH', rebase: 'REBASE' }

/** Merge, close, reopen, mark ready or update the branch. A merge whose reply is lost is checked before it fails. */
export async function pullRequestAction(cwd: string, url: string, action: PullRequestAction): Promise<void> {
  const { owner, repo, pr } = await readOne(cwd, url)
  const id = pr.id
  switch (action.kind) {
    case 'merge': {
      try {
        await githubGraphql(
          cwd,
          `mutation($id: ID!, $method: PullRequestMergeMethod!, $head: GitObjectID) {
            mergePullRequest(input: { pullRequestId: $id, mergeMethod: $method, expectedHeadOid: $head }) { clientMutationId }
          }`,
          { id, method: MERGE_METHOD[action.method], head: pr.headRefOid ?? null },
        )
      } catch (error) {
        const after = await readOne(cwd, url).catch(() => null)
        if (after?.pr.state.toUpperCase() !== 'MERGED') throw error
      }
      if (action.deleteBranch && !pr.isCrossRepository)
        await githubRest(
          cwd,
          'DELETE',
          `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(pr.headRefName).replace(/%2F/g, '/')}`,
        ).catch(() => {
          // A branch already deleted by the repository's own setting is the outcome that was asked for.
        })
      return
    }
    case 'close':
      await githubGraphql(
        cwd,
        'mutation($id: ID!) { closePullRequest(input: { pullRequestId: $id }) { clientMutationId } }',
        {
          id,
        },
      )
      return
    case 'reopen':
      await githubGraphql(
        cwd,
        'mutation($id: ID!) { reopenPullRequest(input: { pullRequestId: $id }) { clientMutationId } }',
        {
          id,
        },
      )
      return
    case 'ready':
      await githubGraphql(
        cwd,
        'mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { clientMutationId } }',
        { id },
      )
      return
    case 'update-branch':
      await githubGraphql(
        cwd,
        `mutation($id: ID!, $head: GitObjectID) {
          updatePullRequestBranch(input: { pullRequestId: $id, expectedHeadOid: $head }) { clientMutationId }
        }`,
        { id, head: pr.headRefOid ?? null },
      )
      return
  }
}

/** The pull request's description, for the first message of a thread opened on it. */
export async function pullRequestBody(cwd: string, url: string): Promise<string> {
  return (await readOne(cwd, url)).pr.body ?? ''
}

// ---- Review threads ----

interface RawAuthor {
  login: string
  __typename: string
}

interface RawThreads {
  repository: {
    pullRequest: {
      id: string
      author: { login: string } | null
      reviewRequests: { nodes: { requestedReviewer: { login?: string } | null }[] }
      reviewThreads: {
        nodes: {
          id: string
          isResolved: boolean
          isOutdated: boolean
          path: string
          line: number | null
          viewerCanResolve: boolean
          comments: {
            nodes: {
              id: string
              author: RawAuthor | null
              authorAssociation: string
              body: string
              createdAt: string
            }[]
          }
        }[]
      }
      reviews: {
        nodes: {
          id: string
          state: string
          body: string
          author: RawAuthor | null
          authorAssociation: string
          createdAt: string
        }[]
      }
    } | null
  }
}

const THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id
      author { login }
      reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } } } }
      reviewThreads(first: 100) {
        nodes {
          id isResolved isOutdated path line viewerCanResolve
          comments(first: 50) { nodes { id author { login __typename } authorAssociation body createdAt } }
        }
      }
      reviews(last: 30) { nodes { id state body author { login __typename } authorAssociation createdAt } }
    }
  }
}`

const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

/**
 * Inline threads, plus each review's summary as a thread of its own (replying to one posts a pull request comment that
 * quotes it). A comment is trusted from people with write access, requested reviewers, the author and bots.
 */
export function parseReviewThreads(raw: NonNullable<RawThreads['repository']['pullRequest']>): PullRequestThread[] {
  const author = raw.author?.login.toLowerCase() ?? ''
  const requested = new Set(
    raw.reviewRequests.nodes.map((node) => node.requestedReviewer?.login?.toLowerCase() ?? '').filter(Boolean),
  )
  const comment = (node: {
    id: string
    author: RawAuthor | null
    authorAssociation: string
    body: string
    createdAt: string
  }) => {
    const login = node.author?.login ?? null
    const bot = node.author?.__typename === 'Bot'
    return {
      id: node.id,
      author: login,
      bot,
      trusted:
        bot ||
        TRUSTED_ASSOCIATIONS.has(node.authorAssociation) ||
        (!!login && (login.toLowerCase() === author || requested.has(login.toLowerCase()))),
      body: node.body.trim(),
      createdAt: Date.parse(node.createdAt) || 0,
    }
  }
  const inline: PullRequestThread[] = raw.reviewThreads.nodes
    .filter((thread) => thread.comments.nodes.length)
    .map((thread) => ({
      id: thread.id,
      path: thread.path,
      line: thread.line,
      outdated: thread.isOutdated,
      resolved: thread.isResolved,
      resolvable: thread.viewerCanResolve,
      comments: thread.comments.nodes.map(comment),
    }))
  const summaries: PullRequestThread[] = raw.reviews.nodes
    .filter((review) => review.body.trim() && review.state !== 'DISMISSED' && review.state !== 'PENDING')
    .map((review) => ({
      id: `review:${review.id}`,
      path: null,
      line: null,
      outdated: false,
      resolved: false,
      resolvable: false,
      comments: [comment(review)],
    }))
  return [...summaries, ...inline]
}

async function readThreads(cwd: string, url: string) {
  const { owner, repo } = await repository(cwd)
  const number = pullNumber(url)
  const raw = await githubGraphql<RawThreads>(cwd, THREADS_QUERY, { owner, repo, number })
  const pr = raw.repository.pullRequest
  if (!pr) throw new Error(`Pull request #${number} was not found with this account.`)
  return { owner, repo, number, pr }
}

export async function reviewThreads(cwd: string, url: string): Promise<PullRequestThread[]> {
  return parseReviewThreads((await readThreads(cwd, url)).pr)
}

const quote = (text: string) =>
  text
    .split('\n')
    .slice(0, 6)
    .map((line) => `> ${line}`)
    .join('\n')

/** Posts one reply and returns the new comment's id. */
export async function replyToThread(cwd: string, url: string, threadId: string, body: string): Promise<string> {
  if (threadId.startsWith('review:')) {
    const { pr } = await readThreads(cwd, url)
    const review = pr.reviews.nodes.find((node) => `review:${node.id}` === threadId)
    const text = review ? `${quote(review.body.trim())}\n\n${body}` : body
    const result = await githubGraphql<{ addComment: { commentEdge: { node: { id: string } } } }>(
      cwd,
      'mutation($id: ID!, $body: String!) { addComment(input: { subjectId: $id, body: $body }) { commentEdge { node { id } } } }',
      { id: pr.id, body: text },
    )
    return result.addComment.commentEdge.node.id
  }
  const result = await githubGraphql<{ addPullRequestReviewThreadReply: { comment: { id: string } } }>(
    cwd,
    `mutation($id: ID!, $body: String!) {
      addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) { comment { id } }
    }`,
    { id: threadId, body },
  )
  return result.addPullRequestReviewThreadReply.comment.id
}

export async function resolveThread(cwd: string, _url: string, threadId: string): Promise<void> {
  if (threadId.startsWith('review:')) return
  await githubGraphql(
    cwd,
    'mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { clientMutationId } }',
    {
      id: threadId,
    },
  )
}

export async function requestReviews(cwd: string, url: string, reviewers: string[]): Promise<void> {
  if (!reviewers.length) return
  const { owner, repo } = await repository(cwd)
  await githubRest(cwd, 'POST', `/repos/${owner}/${repo}/pulls/${pullNumber(url)}/requested_reviewers`, {
    reviewers,
  })
}

const REVIEW_EVENT: Record<ReviewVerdict, string> = {
  comment: 'COMMENT',
  approve: 'APPROVE',
  'request-changes': 'REQUEST_CHANGES',
}

/** One review with its inline comments, on the pull request's current head. */
export async function submitReview(
  cwd: string,
  url: string,
  review: { verdict: ReviewVerdict; body: string; comments: ReviewCommentDraft[] },
): Promise<void> {
  const { owner, repo, pr } = await readOne(cwd, url)
  await githubRest(cwd, 'POST', `/repos/${owner}/${repo}/pulls/${pr.number}/reviews`, {
    ...(pr.headRefOid ? { commit_id: pr.headRefOid } : {}),
    body: review.body,
    event: REVIEW_EVENT[review.verdict],
    comments: review.comments.map((comment) => ({
      path: comment.path,
      line: comment.line,
      side: 'RIGHT',
      body: comment.body,
    })),
  })
}
