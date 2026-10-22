// Direct GitHub API access with a token Ramu saved on this host, for hosts without the `gh` CLI. The token goes only
// to its own origin: redirects are refused (a job-log redirect is followed by hand, without the token, to its
// signed URL). Responses are mapped to the same shapes `gh --json` returns so one parser serves both paths.
import { githubApiBase, redactSecrets } from '@ramu/shared/forgeRemote'

export interface ApiAccess {
  origin: string
  token: string
  owner: string
  repo: string
}

export type ApiFetch = (url: string, init: RequestInit) => Promise<Response>

export class GithubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly unauthorized = status === 401,
  ) {
    super(message)
  }
}

const headers = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'Ramu',
})

function failure(status: number, body: string): GithubApiError {
  const detail = redactSecrets(body.slice(0, 300))
  if (status === 401)
    return new GithubApiError('HTTP 401: the saved GitHub token was rejected. It may be expired or revoked.', status)
  if (status === 403 || status === 429)
    return new GithubApiError(
      `HTTP ${status}: GitHub refused the request (rate limit or a missing permission). ${detail}`,
      status,
    )
  if (status === 404)
    return new GithubApiError(
      'HTTP 404: not found with this account. The repository may be private or need organization approval.',
      status,
    )
  return new GithubApiError(`HTTP ${status}: ${detail}`, status)
}

/** One API call. JSON in and out; a non-success status becomes a `GithubApiError` with provider text redacted. */
export async function apiRequest<T>(
  access: ApiAccess,
  path: string,
  options: { method?: string; body?: unknown; fetch?: ApiFetch } = {},
): Promise<T> {
  const url = path.startsWith('/graphql') ? graphqlUrl(access.origin) : `${githubApiBase(access.origin)}${path}`
  const response = await (options.fetch ?? fetch)(url, {
    method: options.method ?? 'GET',
    headers: { ...headers(access.token), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw failure(response.status, await response.text().catch(() => ''))
  return (await response.json()) as T
}

const graphqlUrl = (origin: string) =>
  origin === 'github.com' ? 'https://api.github.com/graphql' : `https://${origin}/api/graphql`

export interface DirectPullRequest {
  number: number
  title: string
  url: string
  state: string
  isDraft: boolean
  baseRefName: string
  headRefName: string
  headRefOid?: string
  reviewDecision?: string | null
  statusCheckRollup?: {
    __typename: string
    name?: string
    context?: string
    status?: string
    conclusion?: string | null
    state?: string
    detailsUrl?: string
    targetUrl?: string
    startedAt?: string
  }[]
}

interface RestPull {
  number: number
  title: string
  html_url: string
  state: string
  merged_at?: string | null
  draft?: boolean
  base: { ref: string }
  head: { ref: string; sha: string }
}
interface RestReview {
  state: string
  user: { login: string } | null
  submitted_at?: string
}
interface RestCheckRun {
  name: string
  status: string
  conclusion: string | null
  details_url?: string | null
  html_url?: string | null
  started_at?: string | null
}
interface RestStatus {
  context: string
  state: string
  target_url?: string | null
}

/** The latest decisive review per reviewer decides, like GitHub's own summary: any open change request blocks. */
export function reviewDecisionOf(reviews: RestReview[]): string | null {
  const latest = new Map<string, string>()
  for (const review of [...reviews].sort((a, b) => (a.submitted_at ?? '').localeCompare(b.submitted_at ?? ''))) {
    if (!review.user) continue
    if (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED') latest.set(review.user.login, review.state)
    else if (review.state === 'DISMISSED') latest.delete(review.user.login)
  }
  const states = [...latest.values()]
  if (states.includes('CHANGES_REQUESTED')) return 'CHANGES_REQUESTED'
  return states.includes('APPROVED') ? 'APPROVED' : null
}

export function toDirectPullRequest(
  pull: RestPull,
  reviews: RestReview[],
  runs: RestCheckRun[],
  statuses: RestStatus[],
): DirectPullRequest {
  return {
    number: pull.number,
    title: pull.title,
    url: pull.html_url,
    state: pull.merged_at ? 'MERGED' : pull.state,
    isDraft: pull.draft === true,
    baseRefName: pull.base.ref,
    headRefName: pull.head.ref,
    headRefOid: pull.head.sha,
    reviewDecision: reviewDecisionOf(reviews),
    statusCheckRollup: [
      ...runs.map((run) => ({
        __typename: 'CheckRun',
        name: run.name,
        status: run.status.toUpperCase(),
        conclusion: run.conclusion?.toUpperCase() ?? null,
        detailsUrl: run.details_url ?? run.html_url ?? undefined,
        startedAt: run.started_at ?? undefined,
      })),
      ...statuses.map((status) => ({
        __typename: 'StatusContext',
        context: status.context,
        state: status.state.toUpperCase(),
        targetUrl: status.target_url ?? undefined,
      })),
    ],
  }
}

const pullNumber = (url: string) => /\/pull\/(\d+)/.exec(url)?.[1]

/**
 * The pull request behind a URL, or the branch's open (else most recent) one. Null when the branch has none.
 * Checks and reviews are read for the head commit; a failure reading them fails the call rather than reporting a pass.
 */
export async function findPullRequest(
  access: ApiAccess,
  target: { url?: string; branch: string },
  fetchImpl?: ApiFetch,
): Promise<DirectPullRequest | null> {
  const base = `/repos/${access.owner}/${access.repo}`
  const call = <T>(path: string) => apiRequest<T>(access, path, { fetch: fetchImpl })
  let pull: RestPull | undefined
  const number = target.url ? pullNumber(target.url) : undefined
  if (number) pull = await call<RestPull>(`${base}/pulls/${number}`)
  else {
    const head = encodeURIComponent(`${access.owner}:${target.branch}`)
    for (const state of ['open', 'all']) {
      const found = await call<RestPull[]>(
        `${base}/pulls?head=${head}&state=${state}&per_page=1&sort=updated&direction=desc`,
      )
      if (found[0]) {
        pull = found[0]
        break
      }
    }
  }
  if (!pull) return null
  const [reviews, runs, statuses] = await Promise.all([
    call<RestReview[]>(`${base}/pulls/${pull.number}/reviews?per_page=100`),
    call<{ check_runs: RestCheckRun[] }>(`${base}/commits/${pull.head.sha}/check-runs?per_page=100`).then(
      (r) => r.check_runs,
    ),
    call<{ statuses: RestStatus[] }>(`${base}/commits/${pull.head.sha}/status?per_page=100`).then((r) => r.statuses),
  ])
  return toDirectPullRequest(pull, reviews, runs, statuses)
}

export async function createPull(
  access: ApiAccess,
  input: { title: string; body: string; head: string; base: string; draft: boolean },
  fetchImpl?: ApiFetch,
): Promise<void> {
  await apiRequest(access, `/repos/${access.owner}/${access.repo}/pulls`, {
    method: 'POST',
    body: { title: input.title, body: input.body, head: input.head, base: input.base, draft: input.draft },
    fetch: fetchImpl,
  })
}

interface RestIssue {
  number: number
  title: string
  html_url: string
  body?: string | null
  labels?: ({ name?: string } | string)[]
  updated_at?: string
  pull_request?: unknown
  user?: { login: string } | null
}
const labelNames = (labels: RestIssue['labels']) =>
  (labels ?? []).map((label) => (typeof label === 'string' ? label : (label.name ?? ''))).filter(Boolean)

/** Open issues, newest activity first. The issues endpoint also lists pull requests; those are dropped. */
export async function listIssuesDirect(
  access: ApiAccess,
  search: string,
  fetchImpl?: ApiFetch,
): Promise<{ number: number; title: string; url: string; labels: string[]; updatedAt: string }[]> {
  const text = search.trim()
  const items = text
    ? (
        await apiRequest<{ items: RestIssue[] }>(
          access,
          `/search/issues?q=${encodeURIComponent(`repo:${access.owner}/${access.repo} is:issue is:open ${text}`)}&per_page=50`,
          { fetch: fetchImpl },
        )
      ).items
    : await apiRequest<RestIssue[]>(
        access,
        `/repos/${access.owner}/${access.repo}/issues?state=open&per_page=50&sort=updated&direction=desc`,
        { fetch: fetchImpl },
      )
  return items
    .filter((issue) => !issue.pull_request)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      labels: labelNames(issue.labels),
      updatedAt: issue.updated_at ?? '',
    }))
}

export async function issueDirect(
  access: ApiAccess,
  number: number,
  fetchImpl?: ApiFetch,
): Promise<{
  number: number
  title: string
  url: string
  body: string
  labels: { name: string }[]
  comments: { author: { login: string } | null; body: string }[]
}> {
  const base = `/repos/${access.owner}/${access.repo}/issues/${number}`
  const [issue, comments] = await Promise.all([
    apiRequest<RestIssue>(access, base, { fetch: fetchImpl }),
    apiRequest<{ user: { login: string } | null; body: string }[]>(access, `${base}/comments?per_page=50`, {
      fetch: fetchImpl,
    }),
  ])
  return {
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    body: issue.body ?? '',
    labels: labelNames(issue.labels).map((name) => ({ name })),
    comments: comments.map((comment) => ({ author: comment.user, body: comment.body })),
  }
}

/** GraphQL for review threads: same document `gh api graphql` runs. */
export async function graphql<T>(
  access: ApiAccess,
  query: string,
  variables: Record<string, unknown>,
  fetchImpl?: ApiFetch,
): Promise<T> {
  const result = await apiRequest<T & { errors?: { message: string }[] }>(access, '/graphql', {
    method: 'POST',
    body: { query, variables },
    fetch: fetchImpl,
  })
  if (result.errors?.length) throw new GithubApiError(redactSecrets(result.errors[0]!.message), 200)
  return result
}

/**
 * An Actions job log. GitHub answers with a redirect to a signed blob URL; that URL is fetched without the token so
 * the credential never leaves its own origin.
 */
export async function jobLog(access: ApiAccess, jobId: string, fetchImpl: ApiFetch = fetch): Promise<string> {
  const first = await fetchImpl(
    `${githubApiBase(access.origin)}/repos/${access.owner}/${access.repo}/actions/jobs/${jobId}/logs`,
    {
      headers: headers(access.token),
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (first.status >= 300 && first.status < 400) {
    const location = first.headers.get('location')
    if (!location) throw failure(first.status, '')
    const target = new URL(location)
    if (target.protocol !== 'https:') throw new GithubApiError('The log location was not https.', first.status)
    const second = await fetchImpl(target.toString(), { redirect: 'error', signal: AbortSignal.timeout(30_000) })
    if (!second.ok) throw failure(second.status, '')
    return second.text()
  }
  if (!first.ok) throw failure(first.status, await first.text().catch(() => ''))
  return first.text()
}

interface RestRepository {
  full_name: string
  description: string | null
  private: boolean
  html_url: string
  updated_at: string
}

export async function repositoriesDirect(
  access: Pick<ApiAccess, 'origin' | 'token'>,
  lookup: string | null,
  fetchImpl?: ApiFetch,
): Promise<
  { nameWithOwner: string; description: string | null; isPrivate: boolean; url: string; updatedAt: string }[]
> {
  const full = { ...access, owner: '', repo: '' }
  const items = lookup
    ? [await apiRequest<RestRepository>(full, `/repos/${lookup}`, { fetch: fetchImpl })]
    : await apiRequest<RestRepository[]>(
        full,
        '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member',
        {
          fetch: fetchImpl,
        },
      )
  return items.map((item) => ({
    nameWithOwner: item.full_name,
    description: item.description,
    isPrivate: item.private,
    url: item.html_url,
    updatedAt: item.updated_at,
  }))
}
