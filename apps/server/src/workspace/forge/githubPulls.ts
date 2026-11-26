// GitHub pull request lists, actions, review threads and replies. Reads and writes go through `githubGraphql` and
// `githubRest`, so the signed-in `gh` and a saved token behave the same.
import type {
  MergeRules,
  PullRequestFile,
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
  PullRequestConversationComment,
  PullRequestReaction,
  PullRequestThreadStatus,
  PullRequestUpdate,
} from '@ramu/shared/types'
import { unsupportedPullRequestText } from '@ramu/shared/pullRequestSupport'
import { pullRequestWaiting } from '@ramu/shared/pullRequests'
import { ForgeError, forgeRemoteOf, githubAvailability, githubGraphql, githubRest } from './github'
import { FILES_PAGE, boundedPatch } from './adapter'

const PR_FRAGMENT = `fragment pr on PullRequest {
  id number title url state isDraft baseRefName headRefName headRefOid updatedAt isCrossRepository
  reviewDecision mergeable mergeStateStatus additions deletions
  labels(first: 10) { nodes { name } }
  author { login }
  reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { slug } } } }
  latestOpinionatedReviews(first: 20) { nodes { state author { login } } }
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
  /** Each reviewer's latest review that approves or requests changes. */
  latestOpinionatedReviews?: { nodes: { state: string; author: { login: string } | null }[] }
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
  const reviewed = (verdict: string) =>
    (raw.latestOpinionatedReviews?.nodes ?? [])
      .filter((review) => review.state === verdict && review.author)
      .map((review) => review.author!.login)
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
    ...(raw.latestOpinionatedReviews
      ? { approvedBy: reviewed('APPROVED'), changesRequestedBy: reviewed('CHANGES_REQUESTED') }
      : {}),
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

/**
 * Open pull requests (and, when asked, the latest closed and merged ones) of the checkout's repository, or of
 * `elsewhere` (`owner/repo` on the same server) read as the checkout's account.
 */
export async function listPullRequests(
  cwd: string,
  options: { includeClosed: boolean },
  elsewhere?: string,
): Promise<PullRequestList> {
  const availability = await githubAvailability(cwd)
  if (availability !== 'ready') return { availability, viewer: null, pullRequests: [] }
  const named: string = elsewhere ?? (await repository(cwd).then((remote) => `${remote.owner}/${remote.repo}`))
  const scope = `repo:${named} is:pr`
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
  return { availability, viewer, pullRequests: await withWaiting(cwd, named, pullRequests) }
}

const RULES_TTL = 10 * 60_000
const rulesCache = new Map<string, { at: number; rules: Promise<MergeRules | null> }>()

interface RawBranchRule {
  type: string
  parameters?: {
    required_approving_review_count?: number
    require_code_owner_review?: boolean
    required_review_thread_resolution?: boolean
  }
}

/** What GitHub's rulesets require of a pull request into `branch`; the strictest of the rules that apply. */
export function parseBranchRules(raw: RawBranchRule[]): MergeRules {
  const pulls = raw.filter((rule) => rule.type === 'pull_request').map((rule) => rule.parameters ?? {})
  const approvals = Math.max(0, ...pulls.map((rule) => rule.required_approving_review_count ?? 0))
  return {
    ...(approvals ? { approvals } : {}),
    ...(pulls.some((rule) => rule.require_code_owner_review) ? { codeOwners: true } : {}),
    ...(pulls.some((rule) => rule.required_review_thread_resolution) ? { conversations: true } : {}),
    ...(raw.some((rule) => rule.type === 'merge_queue') ? { queue: true } : {}),
  }
}

/**
 * The rules of one branch, read once every few minutes. Null when GitHub does not say: an older server, a repository
 * that uses classic branch protection (readable only by its admins), or an account that cannot read rules. The pull
 * request then says only that it waits on review.
 */
function branchRules(cwd: string, named: string, branch: string): Promise<MergeRules | null> {
  const key = `${named}\n${branch}`
  const cached = rulesCache.get(key)
  if (cached && Date.now() - cached.at < RULES_TTL) return cached.rules
  const rules = githubRest<RawBranchRule[]>(cwd, 'GET', `/repos/${named}/rules/branches/${encodeURIComponent(branch)}`)
    .then((raw) => (Array.isArray(raw) && raw.length ? parseBranchRules(raw) : null))
    .catch(() => null)
  rulesCache.set(key, { at: Date.now(), rules })
  if (rulesCache.size > 200) rulesCache.delete(rulesCache.keys().next().value!)
  return rules
}

/** Adds what each open pull request waits on people for, reading each base branch's rules once. */
async function withWaiting(
  cwd: string,
  named: string,
  pullRequests: PullRequestSummary[],
): Promise<PullRequestSummary[]> {
  const bases = [...new Set(pullRequests.filter((pr) => pr.state === 'open' && !pr.draft).map((pr) => pr.baseBranch))]
  const rules = new Map(
    await Promise.all(bases.map(async (base) => [base, await branchRules(cwd, named, base)] as const)),
  )
  return pullRequests.map((pr) => {
    const waiting = pr.draft ? null : pullRequestWaiting(pr, rules.get(pr.baseBranch) ?? null)
    return waiting ? { ...pr, waiting } : pr
  })
}

/** The server, repository and number a GitHub pull request link names; anything else is refused. */
export function pullRequestLink(url: string): { origin: string; owner: string; repo: string; number: number } {
  let parsed: URL | null = null
  try {
    parsed = new URL(url)
  } catch {
    // Reported below with every other link that is not a pull request's.
  }
  // A server on a sub-path adds segments in front; the two before `/pull/` always name the repository.
  const match = parsed && /\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/.exec(parsed.pathname)
  if (!parsed || !match || !['https:', 'http:'].includes(parsed.protocol))
    throw new Error('That is not a GitHub pull request link.')
  return { origin: parsed.host.toLowerCase(), owner: match[1]!, repo: match[2]!, number: Number(match[3]) }
}

/**
 * The repository a pull request link names, read through the checkout's server and account. The link decides the
 * repository, so a pull request of a fork's upstream or of a repository in no project reads as itself.
 */
export async function pullRequestTarget(cwd: string, url: string) {
  const remote = await repository(cwd)
  const link = pullRequestLink(url)
  if (link.origin !== remote.origin) throw new Error(`That pull request is not on ${remote.origin}.`)
  return link
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
  const { owner, repo, number } = await pullRequestTarget(cwd, url)
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
  if (merge === 'behind')
    blockers.push('It is behind its base branch, and this repository requires it to be up to date.')
  if (merge === 'blocked') blockers.push('Branch protection is blocking it. Required reviews or checks are missing.')
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
    case 'draft':
      await githubGraphql(
        cwd,
        'mutation($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { clientMutationId } }',
        { id },
      )
      return
    // GitHub deletes the branch after an automatic merge only by the repository's own setting.
    case 'auto-merge':
      await githubGraphql(
        cwd,
        `mutation($id: ID!, $method: PullRequestMergeMethod!) {
          enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $method }) { clientMutationId }
        }`,
        { id, method: MERGE_METHOD[action.method] },
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
  avatarUrl?: string
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
          viewerCanUnresolve?: boolean
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
          id isResolved isOutdated path line viewerCanResolve viewerCanUnresolve
          comments(first: 50) { nodes { id author { login __typename avatarUrl(size: 64) } authorAssociation body createdAt } }
        }
      }
      reviews(last: 30) { nodes { id state body author { login __typename avatarUrl(size: 64) } authorAssociation createdAt } }
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
      ...(node.author?.avatarUrl ? { avatarUrl: node.author.avatarUrl } : {}),
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
      // GitHub answers whether the viewer can take the next step, so a resolved thread asks about unresolving.
      resolvable: thread.isResolved ? thread.viewerCanUnresolve === true : thread.viewerCanResolve,
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
  const { owner, repo, number } = await pullRequestTarget(cwd, url)
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
  const { owner, repo, number } = await pullRequestTarget(cwd, url)
  await githubRest(cwd, 'POST', `/repos/${owner}/${repo}/pulls/${number}/requested_reviewers`, {
    reviewers,
  })
}

const REVIEW_EVENT: Record<ReviewVerdict, string> = {
  comment: 'COMMENT',
  approve: 'APPROVE',
  'request-changes': 'REQUEST_CHANGES',
}

/** A comment's text with its suggested change in GitHub's fenced form, which the page offers to commit. */
export const withSuggestion = (body: string, suggestion: string | undefined) =>
  suggestion === undefined ? body : `${body}\n\n\`\`\`suggestion\n${suggestion}\n\`\`\``

/** Where a comment sits in GitHub's terms: the line, its side and where a block of lines starts. */
const placement = (comment: Omit<ReviewCommentDraft, 'id'>) => {
  const side = comment.side === 'old' ? 'LEFT' : 'RIGHT'
  return {
    path: comment.path,
    line: comment.line,
    side,
    ...(comment.startLine && comment.startLine < comment.line
      ? { start_line: comment.startLine, start_side: side }
      : {}),
    body: withSuggestion(comment.body, comment.suggestion),
  }
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
    comments: review.comments.map(placement),
  })
}

interface RawConversation {
  repository: {
    pullRequest: {
      comments: {
        nodes: {
          id: string
          author: RawAuthor | null
          authorAssociation: string
          body: string
          createdAt: string
          viewerDidAuthor: boolean
        }[]
      }
    } | null
  }
}

/** The latest comments on the pull request itself; review summaries are threads already. */
export async function conversation(cwd: string, url: string): Promise<PullRequestConversationComment[]> {
  const { owner, repo, number } = await pullRequestTarget(cwd, url)
  const raw = await githubGraphql<RawConversation>(
    cwd,
    `query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          comments(last: 50) { nodes { id author { login __typename } authorAssociation body createdAt viewerDidAuthor } }
        }
      }
    }`,
    { owner, repo, number },
  )
  return (raw.repository.pullRequest?.comments.nodes ?? []).map((node) => ({
    id: node.id,
    author: node.author?.login ?? null,
    bot: node.author?.__typename === 'Bot',
    trusted: node.author?.__typename === 'Bot' || TRUSTED_ASSOCIATIONS.has(node.authorAssociation),
    body: node.body.trim(),
    createdAt: Date.parse(node.createdAt) || 0,
    own: node.viewerDidAuthor,
  }))
}

export async function comment(cwd: string, url: string, body: string): Promise<string> {
  const { pr } = await readOne(cwd, url)
  const result = await githubGraphql<{ addComment: { commentEdge: { node: { id: string } } } }>(
    cwd,
    'mutation($id: ID!, $body: String!) { addComment(input: { subjectId: $id, body: $body }) { commentEdge { node { id } } } }',
    { id: pr.id, body },
  )
  return result.addComment.commentEdge.node.id
}

/** A single line comment outside a review, on the head commit; returns its node id so it can be edited or deleted. */
export async function lineComment(cwd: string, url: string, draft: Omit<ReviewCommentDraft, 'id'>): Promise<string> {
  const { owner, repo, pr } = await readOne(cwd, url)
  const created = await githubRest<{ node_id: string }>(
    cwd,
    'POST',
    `/repos/${owner}/${repo}/pulls/${pr.number}/comments`,
    {
      ...(pr.headRefOid ? { commit_id: pr.headRefOid } : {}),
      ...placement(draft),
    },
  )
  return created.node_id
}

/** GitHub's node ids say what they are: a conversation comment, a line comment or a review. */
function commentKind(commentId: string): 'issue' | 'line' | 'review' {
  const id = commentId.replace(/^review:/, '')
  if (id.startsWith('IC_')) return 'issue'
  if (id.startsWith('PRRC_')) return 'line'
  if (id.startsWith('PRR_')) return 'review'
  throw new Error('That is not a GitHub comment id. Use one from pull_request_threads.')
}

export async function editComment(cwd: string, _url: string, commentId: string, body: string): Promise<void> {
  const id = commentId.replace(/^review:/, '')
  const mutation = {
    issue: 'updateIssueComment(input: { id: $id, body: $body })',
    line: 'updatePullRequestReviewComment(input: { pullRequestReviewCommentId: $id, body: $body })',
    review: 'updatePullRequestReview(input: { pullRequestReviewId: $id, body: $body })',
  }[commentKind(commentId)]
  await githubGraphql(cwd, `mutation($id: ID!, $body: String!) { ${mutation} { clientMutationId } }`, { id, body })
}

export async function deleteComment(cwd: string, _url: string, commentId: string): Promise<void> {
  const kind = commentKind(commentId)
  if (kind === 'review') throw new Error('GitHub cannot delete a submitted review; edit its text instead.')
  const mutation = kind === 'issue' ? 'deleteIssueComment' : 'deletePullRequestReviewComment'
  await githubGraphql(cwd, `mutation($id: ID!) { ${mutation}(input: { id: $id }) { clientMutationId } }`, {
    id: commentId,
  })
}

export async function setThreadStatus(
  cwd: string,
  url: string,
  threadId: string,
  status: PullRequestThreadStatus,
): Promise<void> {
  if (status !== 'resolved' && status !== 'active')
    throw new Error(unsupportedPullRequestText('github', 'thread-status'))
  if (threadId.startsWith('review:')) throw new Error('A review’s summary is not a thread GitHub can resolve.')
  if (status === 'resolved') return resolveThread(cwd, url, threadId)
  await githubGraphql(
    cwd,
    'mutation($id: ID!) { unresolveReviewThread(input: { threadId: $id }) { clientMutationId } }',
    {
      id: threadId,
    },
  )
}

const REACTION: Record<PullRequestReaction, string> = {
  'thumbs-up': 'THUMBS_UP',
  'thumbs-down': 'THUMBS_DOWN',
  laugh: 'LAUGH',
  hooray: 'HOORAY',
  confused: 'CONFUSED',
  heart: 'HEART',
  rocket: 'ROCKET',
  eyes: 'EYES',
}

export async function react(
  cwd: string,
  _url: string,
  commentId: string,
  reaction: PullRequestReaction,
  remove: boolean,
): Promise<void> {
  const mutation = remove ? 'removeReaction' : 'addReaction'
  await githubGraphql(
    cwd,
    `mutation($id: ID!, $content: ReactionContent!) { ${mutation}(input: { subjectId: $id, content: $content }) { clientMutationId } }`,
    { id: commentId.replace(/^review:/, ''), content: REACTION[reaction] },
  )
}

export async function removeReviewers(cwd: string, url: string, reviewers: string[]): Promise<void> {
  if (!reviewers.length) return
  const { owner, repo, number } = await pullRequestTarget(cwd, url)
  await githubRest(cwd, 'DELETE', `/repos/${owner}/${repo}/pulls/${number}/requested_reviewers`, { reviewers })
}

/**
 * GitHub has no "withdraw": a new review does not clear an approval, so the account's own verdict is dismissed, which
 * needs write access to the repository.
 */
export async function withdrawReview(cwd: string, url: string): Promise<void> {
  const { owner, repo, number } = await pullRequestTarget(cwd, url)
  const raw = await githubGraphql<{
    repository: {
      pullRequest: { reviews: { nodes: { id: string; state: string; viewerDidAuthor: boolean }[] } } | null
    }
  }>(
    cwd,
    `query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviews(last: 50) { nodes { id state viewerDidAuthor } } } }
    }`,
    { owner, repo, number },
  )
  const verdicts = (raw.repository.pullRequest?.reviews.nodes ?? []).filter(
    (review) => review.viewerDidAuthor && (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED'),
  )
  if (!verdicts.length) throw new Error('This account has no approval or change request on that pull request.')
  for (const review of verdicts)
    await githubGraphql(
      cwd,
      'mutation($id: ID!, $message: String!) { dismissPullRequestReview(input: { pullRequestReviewId: $id, message: $message }) { clientMutationId } }',
      { id: review.id, message: 'Withdrawn by the reviewer.' },
    )
}

export async function updatePullRequest(cwd: string, url: string, update: PullRequestUpdate): Promise<void> {
  const { owner, repo, pr } = await readOne(cwd, url)
  const fields = {
    ...(update.title !== undefined ? { title: update.title } : {}),
    ...(update.body !== undefined ? { body: update.body } : {}),
    ...(update.base !== undefined ? { baseRefName: update.base } : {}),
  }
  if (Object.keys(fields).length)
    await githubGraphql(
      cwd,
      `mutation($input: UpdatePullRequestInput!) { updatePullRequest(input: $input) { clientMutationId } }`,
      { input: { pullRequestId: pr.id, ...fields } },
    )
  const issue = `/repos/${owner}/${repo}/issues/${pr.number}`
  if (update.labels?.add.length) await githubRest(cwd, 'POST', `${issue}/labels`, { labels: update.labels.add })
  for (const label of update.labels?.remove ?? [])
    await githubRest(cwd, 'DELETE', `${issue}/labels/${encodeURIComponent(label)}`).catch((error: unknown) => {
      // A label already gone is the outcome that was asked for.
      if (!(error instanceof Error && /\b404\b|not found/i.test(error.message))) throw error
    })
  if (update.assignees?.add.length)
    await githubRest(cwd, 'POST', `${issue}/assignees`, { assignees: update.assignees.add })
  if (update.assignees?.remove.length)
    await githubRest(cwd, 'DELETE', `${issue}/assignees`, { assignees: update.assignees.remove })
}

const FAILED_RUN = new Set(['failure', 'timed_out', 'cancelled', 'startup_failure'])

/** Re-runs the failed jobs of each failed Actions run on the head commit. Other services' checks re-run there. */
export async function rerunChecks(cwd: string, url: string): Promise<number> {
  const { owner, repo, pr } = await readOne(cwd, url)
  if (!pr.headRefOid) throw new Error('GitHub did not say which commit this pull request is on.')
  const runs = await githubRest<{ workflow_runs: { id: number; conclusion: string | null }[] }>(
    cwd,
    'GET',
    `/repos/${owner}/${repo}/actions/runs?head_sha=${pr.headRefOid}&per_page=50`,
  )
  const failed = (runs?.workflow_runs ?? []).filter((run) => run.conclusion && FAILED_RUN.has(run.conclusion))
  if (!failed.length)
    throw new Error('No GitHub Actions run failed on the latest commit; checks from other services re-run there.')
  for (const run of failed)
    await githubRest(cwd, 'POST', `/repos/${owner}/${repo}/actions/runs/${run.id}/rerun-failed-jobs`)
  return failed.length
}

const FILE_STATUS: PullRequestFile['status'][] = [
  'added',
  'modified',
  'removed',
  'renamed',
  'copied',
  'changed',
  'unchanged',
]

/** The first page of files `url` changes, with their patches cut at Ramu's limit. */
export async function pullRequestFiles(cwd: string, url: string): Promise<{ files: PullRequestFile[]; more: boolean }> {
  const { owner, repo, number } = await pullRequestTarget(cwd, url)
  const raw = await githubRest<
    {
      filename: string
      previous_filename?: string
      status: string
      additions: number
      deletions: number
      patch?: string
    }[]
  >(cwd, 'GET', `/repos/${owner}/${repo}/pulls/${number}/files?per_page=${FILES_PAGE}`)
  const files = (raw ?? []).map((file): PullRequestFile => ({
    path: file.filename,
    ...(file.previous_filename ? { previousPath: file.previous_filename } : {}),
    status: FILE_STATUS.includes(file.status as PullRequestFile['status'])
      ? (file.status as PullRequestFile['status'])
      : 'changed',
    additions: file.additions,
    deletions: file.deletions,
    ...boundedPatch(typeof file.patch === 'string' ? file.patch : null),
  }))
  return { files, more: files.length >= FILES_PAGE }
}
