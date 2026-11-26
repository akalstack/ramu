// Bitbucket Cloud pull requests, build statuses and issues through its REST API (2.0). There is no official CLI, so
// the credential is the one saved in Settings or given in the environment (see bitbucketCredentials.ts). Like the
// other adapters, Git runs with argument arrays only, and the credential is sent only to api.bitbucket.org.
import type {
  BitbucketSummary,
  ForgeAccessReport,
  ForgeCheck,
  ForgeCheckResult,
  ForgeCheckState,
  ForgeRepositoryAccount,
  ForgeRepositorySummary,
  ForgeStatus,
  IssueSummary,
  MergeMethod,
  MergeOptions,
  PublishRepositoryInput,
  PullRequestAction,
  PullRequestFile,
  PullRequestList,
  PullRequestSummary,
  PullRequestThread,
  PullRequestTimelineEvent,
  ReviewCommentDraft,
  ReviewVerdict,
  PullRequestInfo,
  PullRequestInput,
  PullRequestReviewDecision,
  PullRequestThreadStatus,
  PullRequestUpdate,
} from '@ramu/shared/types'
import { unsupportedPullRequestText } from '@ramu/shared/pullRequestSupport'
import { parseGitlabRemote } from '@ramu/shared/forgeHosts'
import { redactSecrets } from '@ramu/shared/forgeRemote'
import { currentBranch, git, publishRemote } from '../git'
import { FILES_PAGE, TIMELINE_LENGTH, boundedPatch, opening, registerForgeAdapter } from './adapter'
import { enrichOpen } from './enrich'
import { checksRollup, withPullRequestWaiting } from '@ramu/shared/pullRequests'
import { ForgeError, pullRequestDraft, forgetForgeRemote } from './github'
import { bitbucketCredential, type BitbucketCredential } from './bitbucketCredentials'
import { FAILED_STEPS, failedStepLog } from './buildLogs'

const API = 'https://api.bitbucket.org/2.0'

export interface BitbucketRepository {
  workspace: string
  slug: string
}

/** `workspace/slug` from a bitbucket.org remote, in any of its HTTPS or SSH forms. */
export function parseBitbucketRemote(url: string): BitbucketRepository | null {
  const parsed = parseGitlabRemote(url)
  if (!parsed || parsed.origin !== 'bitbucket.org') return null
  const parts = parsed.path.split('/')
  return parts.length === 2 ? { workspace: parts[0]!, slug: parts[1]! } : null
}

export async function bitbucketRepositoryOf(cwd: string): Promise<BitbucketRepository | null> {
  try {
    const { remote } = await publishRemote(cwd, await currentBranch(cwd))
    return remote ? parseBitbucketRemote((await git(cwd, ['remote', 'get-url', remote])).trim()) : null
  } catch {
    return null
  }
}

type Target = BitbucketCredential & { fetch?: typeof fetch }

function authorization(credential: BitbucketCredential) {
  return credential.email
    ? `Basic ${Buffer.from(`${credential.email}:${credential.token}`).toString('base64')}`
    : `Bearer ${credential.token}`
}

/** One API request. Bounded in time and size; errors never echo the credential or the response body. */
export async function bitbucketApi<T>(
  target: Target,
  path: string,
  init: { method?: string; body?: unknown; text?: boolean } = {},
  redirects = 0,
): Promise<T> {
  const response = await (target.fetch ?? fetch)(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: authorization(target),
      Accept: init.text ? 'text/plain' : 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  }).catch(() => {
    throw new ForgeError('Could not reach Bitbucket. Check the network and try again.', null)
  })
  // A pull request's diff answers with a redirect to the commit-range diff. Only one redirect that stays on the API
  // is followed, so the credential never leaves api.bitbucket.org.
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    if (!location?.startsWith(`${API}/`) || redirects > 0)
      throw new ForgeError('Bitbucket redirected Ramu away from its API, so the request stopped.', null)
    return bitbucketApi<T>(target, location.slice(API.length), init, redirects + 1)
  }
  if (response.status === 401)
    throw new ForgeError(
      'Bitbucket did not accept this credential. Connect again in Settings → Git with a current API token.',
      'signed-out',
    )
  if (response.status === 403)
    throw new ForgeError('This Bitbucket credential does not have permission for that. Check its scopes.', null)
  if (response.status === 404)
    throw new ForgeError('Bitbucket could not find that, or this account cannot see it.', null)
  if (!response.ok) throw new ForgeError(`Bitbucket answered ${response.status}. Try again in a moment.`, null)
  const text = await response.text()
  if (text.length > 8 * 1024 * 1024) throw new ForgeError('Bitbucket sent more than Ramu reads at once.', null)
  return (init.text ? text : text ? JSON.parse(text) : null) as T
}

interface Access {
  cwd: string
  repo: BitbucketRepository
  credential: Target
}

const signInHint = 'Connect Bitbucket in Settings → Git, or set BITBUCKET_EMAIL and BITBUCKET_API_TOKEN on the host.'

async function access(cwd: string): Promise<Access> {
  const repo = await bitbucketRepositoryOf(cwd)
  if (!repo) throw new ForgeError('This repository has no Bitbucket remote.', 'no-remote')
  const credential = await bitbucketCredential()
  if (!credential) throw new ForgeError(signInHint, 'signed-out')
  return { cwd, repo, credential }
}

const q = (value: string) => encodeURIComponent(value)
const repoApi = <T>(a: Access, path = '', init?: { method?: string; body?: unknown; text?: boolean }) =>
  bitbucketApi<T>(a.credential, `/repositories/${q(a.repo.workspace)}/${q(a.repo.slug)}${path}`, init)

interface RawPullRequest {
  id: number
  title: string
  state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED'
  draft?: boolean
  source: { branch: { name: string }; commit?: { hash?: string } }
  destination: { branch: { name: string } }
  links: { html: { href: string } }
  participants?: { role: string; approved?: boolean; state?: string | null }[]
}

interface RawStatus {
  key: string
  name?: string
  state: 'SUCCESSFUL' | 'FAILED' | 'INPROGRESS' | 'STOPPED'
  url?: string
}

export function statusState(state: RawStatus['state']): ForgeCheckState {
  if (state === 'SUCCESSFUL') return 'success'
  if (state === 'FAILED') return 'failure'
  if (state === 'STOPPED') return 'skipped'
  return 'pending'
}

export function parseStatuses(statuses: RawStatus[]): ForgeCheck[] {
  return statuses
    .map((status) => ({ name: status.name || status.key, state: statusState(status.state), url: status.url ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function reviewDecision(participants: RawPullRequest['participants']): PullRequestReviewDecision {
  const reviewers = (participants ?? []).filter((participant) => participant.role === 'REVIEWER')
  if (reviewers.some((reviewer) => reviewer.state === 'changes_requested')) return 'changes-requested'
  if (reviewers.some((reviewer) => reviewer.approved)) return 'approved'
  return reviewers.length ? 'review-required' : null
}

export function parsePullRequest(raw: RawPullRequest, checks: ForgeCheck[]): PullRequestInfo {
  return {
    number: raw.id,
    title: raw.title,
    url: raw.links.html.href,
    state: raw.state === 'MERGED' ? 'merged' : raw.state === 'OPEN' ? 'open' : 'closed',
    draft: Boolean(raw.draft),
    baseBranch: raw.destination.branch.name,
    headBranch: raw.source.branch.name,
    ...(raw.source.commit?.hash ? { headCommit: raw.source.commit.hash } : {}),
    reviewDecision: reviewDecision(raw.participants),
    checks,
  }
}

/** The pull request `url` names, or the newest one for the checked-out branch. */
async function findPullRequest(a: Access, url?: string): Promise<RawPullRequest | null> {
  const id = url ? /\/pull-requests\/(\d+)/.exec(url)?.[1] : undefined
  if (id) return repoApi<RawPullRequest>(a, `/pullrequests/${id}`)
  const branch = await currentBranch(a.cwd)
  if (!branch) return null
  const query = q(`source.branch.name="${branch.replaceAll('"', '\\"')}"`)
  const states = ['OPEN', 'MERGED', 'DECLINED'].map((state) => `state=${state}`).join('&')
  const page = await repoApi<{ values: RawPullRequest[] }>(
    a,
    `/pullrequests?q=${query}&${states}&sort=-updated_on&pagelen=1`,
  )
  return page.values[0] ?? null
}

const checksOf = async (a: Access, id: number) =>
  parseStatuses((await repoApi<{ values: RawStatus[] }>(a, `/pullrequests/${id}/statuses?pagelen=100`)).values)

export async function pullRequestStatus(cwd: string, url?: string): Promise<ForgeStatus> {
  let a: Access
  try {
    a = await access(cwd)
  } catch (error) {
    if (error instanceof ForgeError && error.availability)
      return { availability: error.availability, service: 'bitbucket', pullRequest: null }
    throw error
  }
  const raw = await findPullRequest(a, url)
  if (!raw) return { availability: 'ready', service: 'bitbucket', pullRequest: null }
  const checks = await checksOf(a, raw.id).catch(() => [])
  return { availability: 'ready', service: 'bitbucket', pullRequest: parsePullRequest(raw, checks) }
}

export async function createPullRequest(cwd: string, input: PullRequestInput): Promise<ForgeStatus> {
  const branch = await currentBranch(cwd)
  if (!branch) throw new Error('Switch to a branch before opening a pull request.')
  const a = await access(cwd)
  try {
    await repoApi(a, '/pullrequests', {
      method: 'POST',
      body: {
        title: input.title,
        description: input.body,
        source: { branch: { name: branch } },
        destination: { branch: { name: input.base } },
        ...(input.draft ? { draft: true } : {}),
      },
    })
  } catch (error) {
    // A lost reply does not say whether it was created; look before reporting, so a retry never opens a duplicate.
    const existing = await pullRequestStatus(cwd).catch(() => null)
    if (existing?.pullRequest?.state === 'open' && existing.pullRequest.baseBranch === input.base) return existing
    throw error
  }
  return pullRequestStatus(cwd)
}

/** The build number of a Bitbucket Pipelines result, from the link its build status carries. */
export function pipelineNumber(url: string | null): number | null {
  const match = url ? /bitbucket\.org\/[^/]+\/[^/]+\/pipelines\/results\/(\d+)/.exec(url) : null
  return match ? Number(match[1]) : null
}

/**
 * A step log. Bitbucket answers with a redirect to its log storage; that request goes without the credential, which
 * is only ever sent to api.bitbucket.org.
 */
async function stepLog(target: Target, path: string): Promise<string> {
  const headers = { Authorization: authorization(target) }
  const first = await (target.fetch ?? fetch)(`${API}${path}`, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  })
  let response = first
  if (first.status >= 300 && first.status < 400) {
    const location = first.headers.get('location')
    if (!location?.startsWith('https://')) return ''
    response = await (target.fetch ?? fetch)(location, { redirect: 'error', signal: AbortSignal.timeout(20_000) })
  }
  if (!response.ok) return ''
  if (Number(response.headers.get('content-length') ?? 0) > 32 * 1024 * 1024) return ''
  return response.text()
}

interface RawPipeline {
  uuid: string
  build_number?: number
}

interface RawStep {
  uuid: string
  name?: string
  state?: { result?: { name?: string } }
}

/** The end of each failed step's log for one pipeline run, so the thread starts from the error. */
async function pipelineLogs(a: Access, number: number): Promise<string[]> {
  const pipeline = await repoApi<RawPipeline>(a, `/pipelines/${number}`).catch(async () => {
    const recent = await repoApi<{ values: RawPipeline[] }>(a, '/pipelines/?sort=-created_on&pagelen=50')
    const found = recent.values.find((entry) => entry.build_number === number)
    if (!found) throw new Error('Pipeline not found.')
    return found
  })
  const steps = await repoApi<{ values: RawStep[] }>(a, `/pipelines/${q(pipeline.uuid)}/steps/?pagelen=100`)
  const failed = steps.values.filter((step) => step.state?.result?.name === 'FAILED').slice(0, FAILED_STEPS)
  const logs: string[] = []
  for (const step of failed) {
    const text = await stepLog(
      a.credential,
      `/repositories/${q(a.repo.workspace)}/${q(a.repo.slug)}/pipelines/${q(pipeline.uuid)}/steps/${q(step.uuid)}/log`,
    ).catch(() => '')
    const block = failedStepLog(`${step.name ?? 'Step'} (pipeline #${number})`, text)
    if (block) logs.push(block)
  }
  return logs
}

export async function checksFeedback(cwd: string, url?: string): Promise<string> {
  const a = await access(cwd)
  const raw = await findPullRequest(a, url)
  if (!raw) throw new Error('This branch has no pull request.')
  const pr = parsePullRequest(raw, await checksOf(a, raw.id))
  const failed = pr.checks.filter((check) => check.state === 'failure')
  if (!failed.length) throw new Error('No failing builds.')
  const pipelines = [...new Set(failed.map((check) => pipelineNumber(check.url)).filter((n) => n !== null))]
  const logs = (
    await Promise.all(pipelines.slice(0, FAILED_STEPS).map((n) => pipelineLogs(a, n).catch(() => [])))
  ).flat()
  return redactSecrets(
    [
      `Fix the failing builds on pull request #${pr.number} (${pr.title}). Reproduce each one locally:`,
      '',
      ...failed.map((check) => `- ${check.name}${check.url ? ` (${check.url})` : ''}`),
      ...(logs.length ? ['', 'End of the failed steps’ logs:', '', ...logs] : []),
    ].join('\n'),
  )
}

interface RawIssue {
  id: number
  title: string
  links: { html: { href: string } }
  updated_on?: string
  kind?: string
  content?: { raw?: string }
}

export async function listIssues(cwd: string, search: string): Promise<IssueSummary[]> {
  const a = await access(cwd)
  const text = search.trim().replaceAll('"', '\\"')
  const query = q(`(state="new" OR state="open")${text ? ` AND title~"${text}"` : ''}`)
  // A repository with its issue tracker turned off answers 404: no issues, not a failure.
  const page = await repoApi<{ values: RawIssue[] }>(a, `/issues?q=${query}&sort=-updated_on&pagelen=30`).catch(
    (error) => {
      if (error instanceof ForgeError && /could not find/.test(error.message)) return { values: [] }
      throw error
    },
  )
  return page.values.map((issue) => ({
    number: issue.id,
    title: issue.title,
    url: issue.links.html.href,
    labels: issue.kind ? [issue.kind] : [],
    updatedAt: issue.updated_on ? Date.parse(issue.updated_on) : 0,
  }))
}

export async function issueDetails(cwd: string, number: number) {
  const a = await access(cwd)
  const issue = await repoApi<RawIssue>(a, `/issues/${number}`)
  const body = (issue.content?.raw ?? '').trim().slice(0, 20_000)
  const url = issue.links.html.href
  return {
    title: issue.title,
    url,
    prompt: redactSecrets(`Work on Bitbucket issue #${issue.id}: ${issue.title}\n${url}${body ? `\n\n${body}` : ''}`),
  }
}

interface RawRepository {
  full_name: string
  description?: string
  is_private: boolean
  updated_on?: string
  links: { clone?: { name: string; href: string }[] }
}

export function parseRepositories(raw: RawRepository[]): ForgeRepositorySummary[] {
  return raw.flatMap((repo) => {
    const https = repo.links.clone?.find((link) => link.name === 'https')?.href
    if (!https?.startsWith('https://')) return []
    // Bitbucket puts the account name in the clone address; Ramu never stores credentials in a remote.
    const url = new URL(https)
    url.username = ''
    url.password = ''
    return [
      {
        fullName: repo.full_name,
        description: repo.description || null,
        private: repo.is_private,
        cloneUrl: url.toString(),
        updatedAt: repo.updated_on ? Date.parse(repo.updated_on) : 0,
      },
    ]
  })
}

export async function searchRepositories(search: string): Promise<ForgeRepositorySummary[]> {
  const credential = await bitbucketCredential()
  if (!credential) throw new ForgeError(signInHint, 'signed-out')
  const text = search.trim().replaceAll('"', '\\"')
  const query = text ? `&q=${q(`name~"${text}"`)}` : ''
  return parseRepositories(
    (
      await bitbucketApi<{ values: RawRepository[] }>(
        credential,
        `/repositories?role=member&sort=-updated_on&pagelen=30${query}`,
      )
    ).values,
  )
}

export async function publishRepository(cwd: string, input: PublishRepositoryInput): Promise<void> {
  const remotes = (await git(cwd, ['remote'])).trim().split('\n').filter(Boolean)
  if (remotes.includes('origin')) throw new Error('This repository already has an origin remote.')
  const credential = await bitbucketCredential()
  if (!credential) throw new ForgeError(signInHint, 'signed-out')
  const [workspace, name] = input.name.split('/')
  if (!workspace || !name) throw new Error('Name a Bitbucket repository as workspace/name.')
  const slug = name.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-')
  const repo = await bitbucketApi<RawRepository>(credential, `/repositories/${q(workspace)}/${q(slug)}`, {
    method: 'PUT',
    body: { scm: 'git', is_private: input.visibility !== 'public', name },
  })
  const [clone] = parseRepositories([repo])
  if (!clone) throw new Error('Bitbucket created the repository without an HTTPS address.')
  await git(cwd, ['remote', 'add', 'origin', clone.cloneUrl])
  forgetForgeRemote(cwd)
  await git(cwd, ['push', '-u', 'origin', 'HEAD'])
}

async function whoAmI(credential: Target): Promise<string | null> {
  return bitbucketApi<{ username?: string; nickname?: string; display_name?: string }>(credential, '/user')
    .then((user) => user.username ?? user.nickname ?? user.display_name ?? null)
    .catch(() => null)
}

export async function repositoryAccount(cwd: string): Promise<ForgeRepositoryAccount> {
  const repo = await bitbucketRepositoryOf(cwd)
  if (!repo) return { origin: null, login: null, source: 'none', ambiguous: false }
  const credential = await bitbucketCredential()
  if (!credential) return { origin: 'bitbucket.org', login: null, source: 'none', ambiguous: false }
  return { origin: 'bitbucket.org', login: await whoAmI(credential), source: 'saved', ambiguous: false }
}

const unknown = (detail: string | null = null): ForgeCheckResult => ({ state: 'unknown', detail })

export async function checkAccess(cwd: string): Promise<ForgeAccessReport> {
  const checkedAt = Date.now()
  const repo = await bitbucketRepositoryOf(cwd)
  const none = { source: 'none' as const, login: null, connectionId: null, ambiguous: false }
  if (!repo)
    return {
      origin: null,
      account: none,
      api: { read: unknown('This repository has no Bitbucket remote.'), write: unknown() },
      transport: unknown(),
      checkedAt,
    }
  const transport = await git(cwd, ['ls-remote', '--exit-code', '--heads', 'origin'])
    .then((): ForgeCheckResult => ({ state: 'ok', detail: null }))
    .catch((): ForgeCheckResult => ({
      state: 'failed',
      detail: 'Git could not reach the remote with this host’s Git credentials.',
    }))
  const credential = await bitbucketCredential()
  if (!credential)
    return {
      origin: 'bitbucket.org',
      account: none,
      api: { read: unknown(signInHint), write: unknown() },
      transport,
      checkedAt,
    }
  const account = { source: 'saved' as const, login: await whoAmI(credential), connectionId: null, ambiguous: false }
  const a = { cwd, repo, credential }
  try {
    await repoApi(a)
  } catch (error) {
    return {
      origin: 'bitbucket.org',
      account,
      api: { read: { state: 'failed', detail: (error as Error).message }, write: unknown() },
      transport,
      checkedAt,
    }
  }
  const full = `${repo.workspace}/${repo.slug}`
  const permission = await bitbucketApi<{ values: { permission: string }[] }>(
    credential,
    `/user/permissions/repositories?q=${q(`repository.full_name="${full}"`)}`,
  )
    .then((page) => page.values[0]?.permission ?? null)
    .catch(() => null)
  return {
    origin: 'bitbucket.org',
    account,
    api: {
      read: { state: 'ok', detail: null },
      write:
        permission === null
          ? unknown('Bitbucket did not say whether this account can write here.')
          : permission === 'read'
            ? { state: 'denied', detail: 'This account can read but not push or open pull requests here.' }
            : { state: 'ok', detail: null },
    },
    transport,
    checkedAt,
  }
}

/** What Settings shows: whether a credential is set, where from, and when checked, whose it is. */
export async function bitbucketSummary(
  check: boolean,
  saved: { email: string | null } | null,
): Promise<BitbucketSummary> {
  const credential = await bitbucketCredential()
  if (!credential) return { source: null, email: null, login: null, state: 'unchecked' }
  const base = { source: credential.source, email: credential.email ?? saved?.email ?? null }
  if (!check) return { ...base, login: null, state: 'unchecked' }
  try {
    const user = await bitbucketApi<{ username?: string; nickname?: string; display_name?: string }>(
      credential,
      '/user',
    )
    return { ...base, login: user.username ?? user.nickname ?? user.display_name ?? null, state: 'ok' }
  } catch (error) {
    return { ...base, login: null, state: 'failed', error: redactSecrets((error as Error).message) }
  }
}

// ---- Pull request lists, actions and review threads ----

interface RawUser {
  uuid?: string
  account_id?: string
  username?: string
  nickname?: string
  display_name?: string
  /** `app_user` for apps and bots. */
  type?: string
  links?: { avatar?: { href?: string } }
}

const userName = (user: RawUser | null | undefined) => user?.username ?? user?.nickname ?? user?.display_name ?? null

interface RawListPullRequest extends RawPullRequest {
  author?: RawUser | null
  reviewers?: RawUser[]
  participants?: (NonNullable<RawPullRequest['participants']>[number] & { user?: RawUser })[]
  updated_on?: string
  close_source_branch?: boolean
  description?: string
  source: RawPullRequest['source'] & { repository?: { full_name?: string } }
  destination: RawPullRequest['destination'] & {
    repository?: { full_name?: string }
    branch: { name: string; merge_strategies?: string[] }
  }
}

const isFork = (raw: RawListPullRequest) =>
  !!raw.source.repository?.full_name && raw.source.repository.full_name !== raw.destination.repository?.full_name

/** One pull request as a list row. Bitbucket's list carries no build status or mergeability. */
export function parseListPullRequest(raw: RawListPullRequest, viewer: RawUser | null): PullRequestSummary {
  const reviewers = raw.reviewers ?? []
  const same = (user: RawUser | null | undefined) => !!viewer?.uuid && user?.uuid === viewer.uuid
  const verdicts = (raw.participants ?? []).filter((entry) => entry.role === 'REVIEWER')
  const named = (entries: typeof verdicts) =>
    entries.map((entry) => userName(entry.user)).filter((name): name is string => !!name)
  // Bitbucket's list says who approved and who asked for changes, not how many approvals a branch needs.
  return withPullRequestWaiting({
    ...parsePullRequest(raw, []),
    author: userName(raw.author),
    fork: isFork(raw),
    checks: null,
    mergeable: 'unknown',
    openThreads: null,
    requestedReviewers: reviewers.map(userName).filter((name): name is string => !!name),
    ...(raw.participants
      ? {
          approvedBy: named(verdicts.filter((entry) => entry.approved)),
          changesRequestedBy: named(verdicts.filter((entry) => entry.state === 'changes_requested')),
        }
      : {}),
    group: same(raw.author) ? 'mine' : reviewers.some(same) ? 'review' : 'other',
    updatedAt: raw.updated_on ? Date.parse(raw.updated_on) || 0 : 0,
  })
}

const viewerOf = (a: Access) => bitbucketApi<RawUser>(a.credential, '/user').catch(() => null)

// The list leaves reviewers and participants out unless asked for.
const LIST_FIELDS = `fields=${q('+values.participants,+values.reviewers')}`

export async function listPullRequests(cwd: string, options: { includeClosed: boolean }): Promise<PullRequestList> {
  try {
    const a = await access(cwd)
    const list = (states: string[], count: number) =>
      repoApi<{ values: RawListPullRequest[] }>(
        a,
        `/pullrequests?${states.map((state) => `state=${state}`).join('&')}&sort=-updated_on&pagelen=${count}&${LIST_FIELDS}`,
      ).then((page) => page.values)
    const [viewer, open, closed] = await Promise.all([
      viewerOf(a),
      list(['OPEN'], 50),
      options.includeClosed ? list(['MERGED', 'DECLINED'], 30) : [],
    ])
    return {
      availability: 'ready',
      service: 'bitbucket',
      viewer: userName(viewer),
      pullRequests: await enrichOpen(
        [...open, ...closed].map((raw) => parseListPullRequest(raw, viewer)),
        async (pr) => {
          const [checks, comments] = await Promise.all([checksOf(a, pr.number), readComments(a, pr.number)])
          return {
            checks: checksRollup(checks),
            // Top-level comments nobody resolved are the open threads, as the review threads read them.
            openThreads: comments.filter((comment) => !comment.parent && !comment.deleted && !comment.resolution)
              .length,
          }
        },
      ),
    }
  } catch (error) {
    if (error instanceof ForgeError && error.availability)
      return { availability: error.availability, service: 'bitbucket', viewer: null, pullRequests: [] }
    throw error
  }
}

function idOf(url: string): number {
  const match = /\/pull-requests\/(\d+)(?:[/?#]|$)/.exec(url)
  if (!match) throw new Error('That is not a Bitbucket pull request link.')
  return Number(match[1])
}

const readPullRequest = (a: Access, url: string) => repoApi<RawListPullRequest>(a, `/pullrequests/${idOf(url)}`)

const STRATEGY: Record<MergeMethod, string> = { merge: 'merge_commit', squash: 'squash', rebase: 'fast_forward' }

/** What a merge needs, from the target branch's allowed strategies, the build statuses and the diff's conflicts. */
export function bitbucketMergeOptions(
  pr: RawListPullRequest,
  facts: { checks: ForgeCheck[]; conflicts: boolean; permission: string | null },
): MergeOptions {
  const allowed = pr.destination.branch.merge_strategies
  const methods = (['squash', 'merge', 'rebase'] as const).filter(
    (method) => !allowed || allowed.includes(STRATEGY[method]),
  )
  const blockers: string[] = []
  if (pr.state !== 'OPEN') blockers.push('This pull request is not open.')
  if (pr.draft) blockers.push('It is a draft. Mark it ready for review first.')
  if (facts.conflicts) blockers.push('It has conflicts with its base branch.')
  if (facts.checks.some((check) => check.state === 'failure')) blockers.push('Some checks are failing.')
  if (facts.permission === 'read') blockers.push('This account cannot merge into this repository.')
  if (!methods.length) blockers.push('This repository allows no merge method Ramu can use.')
  return { methods: [...methods], blockers, canDeleteBranch: !isFork(pr) && !pr.close_source_branch }
}

export async function mergeOptions(cwd: string, url: string): Promise<MergeOptions> {
  const a = await access(cwd)
  const pr = await readPullRequest(a, url)
  const full = `${a.repo.workspace}/${a.repo.slug}`
  const [checks, diffstat, permission] = await Promise.all([
    checksOf(a, pr.id).catch(() => []),
    repoApi<{ values: { status?: string }[] }>(a, `/pullrequests/${pr.id}/diffstat?pagelen=500`).catch(() => ({
      values: [],
    })),
    bitbucketApi<{ values: { permission: string }[] }>(
      a.credential,
      `/user/permissions/repositories?q=${q(`repository.full_name="${full}"`)}`,
    )
      .then((page) => page.values[0]?.permission ?? null)
      .catch(() => null),
  ])
  const conflicts = diffstat.values.some((entry) => entry.status === 'merge conflict')
  return bitbucketMergeOptions(pr, { checks, conflicts, permission })
}

const unsupported = (capability: Parameters<typeof unsupportedPullRequestText>[1]) =>
  new Error(unsupportedPullRequestText('bitbucket', capability))

/** Merge, decline, or mark ready or draft. A merge whose reply is lost is checked before it fails. */
export async function pullRequestAction(cwd: string, url: string, action: PullRequestAction): Promise<void> {
  const a = await access(cwd)
  const pr = await readPullRequest(a, url)
  const path = `/pullrequests/${pr.id}`
  switch (action.kind) {
    case 'merge':
      try {
        await repoApi(a, `${path}/merge`, {
          method: 'POST',
          body: {
            type: 'pullrequest',
            merge_strategy: STRATEGY[action.method],
            close_source_branch: action.deleteBranch && !isFork(pr),
          },
        })
      } catch (error) {
        const after = await readPullRequest(a, url).catch(() => null)
        if (after?.state !== 'MERGED') throw error
      }
      return
    case 'close':
      await repoApi(a, `${path}/decline`, { method: 'POST' })
      return
    case 'reopen':
      throw new Error('Bitbucket cannot reopen a declined pull request. Open a new one from the same branch.')
    case 'ready':
    case 'draft':
      await repoApi(a, path, { method: 'PUT', body: { title: pr.title, draft: action.kind === 'draft' } })
      return
    case 'auto-merge':
      throw unsupported('auto-merge')
    case 'update-branch':
      throw new Error(
        'Bitbucket cannot update a pull request’s branch from its base. Merge or rebase the base branch locally and push.',
      )
  }
}

export async function pullRequestBody(cwd: string, url: string): Promise<string> {
  return (await readPullRequest(await access(cwd), url)).description ?? ''
}

interface RawDiffstat {
  status: string
  lines_added?: number
  lines_removed?: number
  old?: { path: string } | null
  new?: { path: string } | null
}

const DIFFSTAT_STATUS: Record<string, PullRequestFile['status']> = {
  added: 'added',
  removed: 'removed',
  modified: 'modified',
  renamed: 'renamed',
}

/**
 * Each file's hunks from a unified diff of the whole pull request, keyed by the file's new path (its old path when
 * removed). Header lines are left off, so a patch starts at its first `@@`; a file with no hunks (binary, or a rename
 * alone) is absent.
 */
function splitDiff(diff: string): Map<string, string> {
  const patches = new Map<string, string>()
  for (const section of diff.split(/^(?=diff --git )/m)) {
    const lines = section.replace(/\n$/, '').split('\n')
    const hunk = lines.findIndex((line) => line.startsWith('@@'))
    if (hunk < 0) continue
    const header = lines.slice(0, hunk)
    const path =
      header.find((line) => line.startsWith('+++ b/'))?.slice(6) ??
      header.find((line) => line.startsWith('--- a/'))?.slice(6)
    if (path) patches.set(path, lines.slice(hunk).join('\n'))
  }
  return patches
}

/** The first page of files `url` changes from its diffstat, with each one's hunks cut at Ramu's limit. */
export async function pullRequestFiles(cwd: string, url: string): Promise<{ files: PullRequestFile[]; more: boolean }> {
  const a = await access(cwd)
  const id = idOf(url)
  const [stat, diff] = await Promise.all([
    repoApi<{ values: RawDiffstat[]; next?: string }>(a, `/pullrequests/${id}/diffstat?pagelen=${FILES_PAGE}`),
    // A diff past what Ramu reads still lists its files, only without patches.
    repoApi<string>(a, `/pullrequests/${id}/diff`, { text: true }).catch(() => ''),
  ])
  const patches = splitDiff(diff)
  const files = stat.values.flatMap((file): PullRequestFile[] => {
    const path = file.new?.path ?? file.old?.path
    if (!path) return []
    const status = DIFFSTAT_STATUS[file.status] ?? 'changed'
    return [
      {
        path,
        ...(status === 'renamed' && file.old?.path ? { previousPath: file.old.path } : {}),
        status,
        additions: file.lines_added ?? 0,
        deletions: file.lines_removed ?? 0,
        ...boundedPatch(patches.get(path) ?? null),
      },
    ]
  })
  return { files, more: !!stat.next }
}

interface RawComment {
  id: number
  content?: { raw?: string }
  deleted?: boolean
  pending?: boolean
  parent?: { id: number }
  resolution?: unknown
  inline?: { path?: string; to?: number | null; from?: number | null; outdated?: boolean }
  user?: RawUser
  created_on?: string
}

interface RawActivity {
  comment?: RawComment & { links?: { html?: { href?: string } } }
  approval?: { date?: string; user?: RawUser }
  changes_request?: { date?: string; user?: RawUser }
  update?: { state?: string; date?: string; author?: RawUser; source?: { commit?: { hash?: string } | null } }
}

const STATE_EVENT: Record<string, PullRequestTimelineEvent['kind']> = {
  MERGED: 'merged',
  DECLINED: 'closed',
  OPEN: 'reopened',
}

const activityTime = (date: string | undefined) => (date ? Date.parse(date) || 0 : 0)

/**
 * Activity, oldest first, as timeline events. An update records the pull request's state and head after it, so a
 * state change or a new head shows only against the update before it; the oldest update read is that baseline.
 */
function activityEvents(activity: RawActivity[]): PullRequestTimelineEvent[] {
  let state: string | undefined
  let head: string | undefined
  return activity.flatMap((entry): PullRequestTimelineEvent[] => {
    if (entry.comment) {
      const comment = entry.comment
      if (comment.deleted || comment.pending) return []
      const text = opening(comment.content?.raw)
      const url = comment.links?.html?.href
      return [
        {
          kind: 'comment',
          actor: userName(comment.user),
          at: activityTime(comment.created_on),
          ...(text ? { text } : {}),
          ...(url ? { url } : {}),
        },
      ]
    }
    if (entry.approval)
      return [
        {
          kind: 'review',
          actor: userName(entry.approval.user),
          at: activityTime(entry.approval.date),
          verdict: 'approved',
        },
      ]
    if (entry.changes_request)
      return [
        {
          kind: 'review',
          actor: userName(entry.changes_request.user),
          at: activityTime(entry.changes_request.date),
          verdict: 'changes-requested',
        },
      ]
    if (!entry.update) return []
    const update = entry.update
    const hash = update.source?.commit?.hash
    const base = { actor: userName(update.author), at: activityTime(update.date) }
    const stateEvent = state && update.state && update.state !== state ? STATE_EVENT[update.state] : undefined
    const pushed = !!head && !!hash && hash !== head
    state = update.state ?? state
    head = hash ?? head
    if (stateEvent) return [{ kind: stateEvent, ...base }]
    return pushed ? [{ kind: 'commit', ...base }] : []
  })
}

/** The latest history of `url`, oldest first: comments, approvals, change requests, pushes and state changes. */
export async function pullRequestTimeline(cwd: string, url: string): Promise<PullRequestTimelineEvent[]> {
  const page = await repoApi<{ values?: RawActivity[] }>(
    await access(cwd),
    `/pullrequests/${idOf(url)}/activity?pagelen=${TIMELINE_LENGTH}`,
  )
  // Bitbucket lists activity newest first.
  return activityEvents([...(page.values ?? [])].reverse()).slice(-TIMELINE_LENGTH)
}

const isBot = (user: RawUser | undefined) => user?.type === 'app_user' || /\[bot\]$/i.test(userName(user) ?? '')

/** The people a pull request names: its author, its reviewers and the account in use. */
function knownPeople(pr: Pick<RawListPullRequest, 'author' | 'reviewers' | 'participants'>, viewer: RawUser | null) {
  return [
    pr.author,
    viewer,
    ...(pr.reviewers ?? []),
    ...(pr.participants ?? []).filter((entry) => entry.role === 'REVIEWER').map((entry) => entry.user),
  ]
    .map((user) => user?.uuid)
    .filter((uuid): uuid is string => !!uuid)
}

/** Workspace membership per workspace and person, kept for a while: it rarely changes and each check is a request. */
const memberships = new Map<string, { member: boolean; at: number }>()
const MEMBERSHIP_TTL = 30 * 60_000

/** The commenters, beyond the people the pull request names, who belong to the repository's workspace. */
async function workspaceMembers(
  a: Access,
  comments: RawComment[],
  pr: Pick<RawListPullRequest, 'author' | 'reviewers' | 'participants'>,
  viewer: RawUser | null,
): Promise<Set<string>> {
  const known = new Set(knownPeople(pr, viewer))
  const unknown = [
    ...new Set(
      comments
        .filter((comment) => !comment.deleted && !isBot(comment.user))
        .map((comment) => comment.user?.uuid)
        .filter((uuid): uuid is string => !!uuid && !known.has(uuid)),
    ),
  ].slice(0, 20)
  const now = Date.now()
  const checked = await Promise.all(
    unknown.map(async (uuid) => {
      const key = `${a.repo.workspace}\n${uuid}`
      const cached = memberships.get(key)
      if (cached && now - cached.at < MEMBERSHIP_TTL) return cached.member ? uuid : null
      // A person outside the workspace answers 404; a token that may not list members answers 403 and trusts no one more.
      const member = await bitbucketApi(a.credential, `/workspaces/${q(a.repo.workspace)}/members/${q(uuid)}`).then(
        () => true,
        () => false,
      )
      memberships.set(key, { member, at: now })
      return member ? uuid : null
    }),
  )
  return new Set(checked.filter((uuid): uuid is string => !!uuid))
}

/**
 * Top-level comments as threads with their replies under them. Bitbucket does not say who can write to the
 * repository, so a comment is trusted from the pull request's author, its reviewers, the account in use, bots and
 * `members` (the commenters found among the repository workspace's members), as GitHub trusts organization members.
 */
export function parseComments(
  comments: RawComment[],
  pr: Pick<RawListPullRequest, 'author' | 'reviewers' | 'participants'>,
  viewer: RawUser | null,
  members: ReadonlySet<string> = new Set(),
): PullRequestThread[] {
  const trustedIds = new Set([...knownPeople(pr, viewer), ...members])
  const live = comments.filter((comment) => !comment.deleted && !comment.pending)
  const byId = new Map(live.map((comment) => [comment.id, comment]))
  const rootOf = (comment: RawComment) => {
    let current = comment
    for (let depth = 0; current.parent && depth < 100; depth++) {
      const parent = byId.get(current.parent.id)
      if (!parent) return null
      current = parent
    }
    return current.parent ? null : current
  }
  const replies = new Map<number, RawComment[]>()
  for (const comment of live) {
    const root = rootOf(comment)
    if (root && root !== comment) replies.set(root.id, [...(replies.get(root.id) ?? []), comment])
  }
  return live
    .filter((comment) => !comment.parent)
    .map((root) => ({
      id: String(root.id),
      path: root.inline?.path ?? null,
      line: root.inline?.to ?? root.inline?.from ?? null,
      outdated: root.inline?.outdated === true,
      resolved: root.resolution != null,
      resolvable: true,
      comments: [root, ...(replies.get(root.id) ?? [])].map((comment) => {
        const bot = isBot(comment.user)
        return {
          id: String(comment.id),
          author: userName(comment.user),
          bot,
          trusted: bot || (!!comment.user?.uuid && trustedIds.has(comment.user.uuid)),
          body: (comment.content?.raw ?? '').trim(),
          createdAt: comment.created_on ? Date.parse(comment.created_on) || 0 : 0,
          ...(comment.user?.links?.avatar?.href ? { avatarUrl: comment.user.links.avatar.href } : {}),
        }
      }),
    }))
}

async function readComments(a: Access, id: number): Promise<RawComment[]> {
  const comments: RawComment[] = []
  let path: string | null = `/pullrequests/${id}/comments?pagelen=100`
  // A long review runs to a few pages; five is far past what a thread hands to an agent.
  for (let page = 0; path && page < 5; page++) {
    const result: { values: RawComment[]; next?: string } = await repoApi(a, path)
    comments.push(...result.values)
    path = result.next?.startsWith(API)
      ? result.next.slice(API.length).replace(/^\/repositories\/[^/]+\/[^/]+/, '')
      : null
  }
  return comments
}

export async function reviewThreads(cwd: string, url: string): Promise<PullRequestThread[]> {
  const a = await access(cwd)
  const [pr, comments, viewer] = await Promise.all([readPullRequest(a, url), readComments(a, idOf(url)), viewerOf(a)])
  return parseComments(comments, pr, viewer, await workspaceMembers(a, comments, pr, viewer))
}

export async function replyToThread(cwd: string, url: string, threadId: string, body: string): Promise<string> {
  const a = await access(cwd)
  const comment = await repoApi<{ id: number }>(a, `/pullrequests/${idOf(url)}/comments`, {
    method: 'POST',
    body: { content: { raw: body }, parent: { id: Number(threadId) } },
  })
  return String(comment.id)
}

export async function resolveThread(cwd: string, url: string, threadId: string): Promise<void> {
  const a = await access(cwd)
  await repoApi(a, `/pullrequests/${idOf(url)}/comments/${q(threadId)}/resolve`, { method: 'POST' })
}

/**
 * Adds the named people as reviewers. Bitbucket finds people by id only, so names are matched against the pull
 * request's reviewers, participants and commenters.
 */
export async function requestReviews(cwd: string, url: string, reviewers: string[]): Promise<void> {
  if (!reviewers.length) return
  const a = await access(cwd)
  const [pr, comments] = await Promise.all([readPullRequest(a, url), readComments(a, idOf(url))])
  const people = [
    pr.author,
    ...(pr.reviewers ?? []),
    ...(pr.participants ?? []).map((entry) => entry.user),
    ...comments.map((comment) => comment.user),
  ].filter((user): user is RawUser => !!user?.uuid)
  const matches = (user: RawUser, name: string) =>
    [user.username, user.nickname, user.display_name, user.uuid, user.account_id].some(
      (value) => value?.toLowerCase() === name.toLowerCase(),
    )
  const wanted = reviewers.map((name) => {
    const user = people.find((person) => matches(person, name))
    if (!user)
      throw new Error(`${name} has not taken part in this pull request, so Bitbucket cannot be asked for them.`)
    return user.uuid!
  })
  const uuids = [...new Set([...(pr.reviewers ?? []).map((user) => user.uuid).filter(Boolean), ...wanted])]
  await repoApi(a, `/pullrequests/${pr.id}`, {
    method: 'PUT',
    body: { title: pr.title, reviewers: uuids.map((uuid) => ({ uuid })) },
  })
}

type LineDraft = Omit<ReviewCommentDraft, 'id'>

/** Where an inline comment goes: `to` a line of the new version, `from` one of the old. Ranges sit on their last line. */
export const inlineOf = (comment: LineDraft) =>
  comment.side === 'old' ? { path: comment.path, from: comment.line } : { path: comment.path, to: comment.line }

const postComment = (a: Access, id: number, body: Record<string, unknown>) =>
  repoApi<{ id: number }>(a, `/pullrequests/${id}/comments`, { method: 'POST', body }).then((posted) =>
    String(posted.id),
  )

/** Inline comments, the summary as a comment, then the approval or the request for changes. */
export async function submitReview(
  cwd: string,
  url: string,
  review: { verdict: ReviewVerdict; body: string; comments: ReviewCommentDraft[] },
): Promise<void> {
  // Refused before anything posts, so a review never goes out without the changes it suggests.
  if (review.comments.some((comment) => comment.suggestion !== undefined)) throw unsupported('suggestion')
  const a = await access(cwd)
  const id = idOf(url)
  const path = `/pullrequests/${id}`
  for (const comment of review.comments)
    await postComment(a, id, { content: { raw: comment.body }, inline: inlineOf(comment) })
  if (review.body.trim()) await postComment(a, id, { content: { raw: review.body } })
  if (review.verdict === 'approve') await repoApi(a, `${path}/approve`, { method: 'POST' })
  if (review.verdict === 'request-changes') await repoApi(a, `${path}/request-changes`, { method: 'POST' })
}

export async function comment(cwd: string, url: string, body: string): Promise<string> {
  return postComment(await access(cwd), idOf(url), { content: { raw: body } })
}

export async function lineComment(cwd: string, url: string, draft: LineDraft): Promise<string> {
  if (draft.suggestion !== undefined) throw unsupported('suggestion')
  return postComment(await access(cwd), idOf(url), { content: { raw: draft.body }, inline: inlineOf(draft) })
}

const commentPath = (url: string, commentId: string) => {
  if (!/^\d+$/.test(commentId)) throw new Error('That is not a Bitbucket comment id.')
  return `/pullrequests/${idOf(url)}/comments/${commentId}`
}

export async function editComment(cwd: string, url: string, commentId: string, body: string): Promise<void> {
  await repoApi(await access(cwd), commentPath(url, commentId), { method: 'PUT', body: { content: { raw: body } } })
}

export async function deleteComment(cwd: string, url: string, commentId: string): Promise<void> {
  await repoApi(await access(cwd), commentPath(url, commentId), { method: 'DELETE' })
}

/** Resolves a thread, or reopens it by taking its resolution away. */
export async function setThreadStatus(
  cwd: string,
  url: string,
  threadId: string,
  status: PullRequestThreadStatus,
): Promise<void> {
  if (status !== 'active' && status !== 'resolved') throw unsupported('thread-status')
  await repoApi(await access(cwd), `${commentPath(url, threadId)}/resolve`, {
    method: status === 'resolved' ? 'POST' : 'DELETE',
  })
}

const react = async (): Promise<void> => {
  throw unsupported('reactions')
}

/** Removes the named reviewers; a name that is not a reviewer is already off the list. */
export async function removeReviewers(cwd: string, url: string, reviewers: string[]): Promise<void> {
  const a = await access(cwd)
  const pr = await readPullRequest(a, url)
  const gone = new Set(reviewers.map((name) => name.toLowerCase()))
  const kept = (pr.reviewers ?? []).filter(
    (user) =>
      !!user.uuid &&
      ![user.username, user.nickname, user.display_name, user.uuid, user.account_id].some(
        (value) => !!value && gone.has(value.toLowerCase()),
      ),
  )
  await repoApi(a, `/pullrequests/${pr.id}`, {
    method: 'PUT',
    body: { title: pr.title, reviewers: kept.map((user) => ({ uuid: user.uuid })) },
  })
}

const notFound = (error: unknown) => error instanceof ForgeError && /could not find/.test(error.message)

/** Takes back the account's approval and its request for changes; Bitbucket answers 404 for the one not given. */
export async function withdrawReview(cwd: string, url: string): Promise<void> {
  const a = await access(cwd)
  const path = `/pullrequests/${idOf(url)}`
  const results = await Promise.all(
    ['approve', 'request-changes'].map((verdict) =>
      repoApi(a, `${path}/${verdict}`, { method: 'DELETE' }).then(
        () => true,
        (error: unknown) => {
          if (notFound(error)) return false
          throw error
        },
      ),
    ),
  )
  if (!results.some(Boolean))
    throw new Error(
      'This account has not approved or requested changes on this pull request, so there is nothing to take back.',
    )
}

/** Title, description and destination branch; Bitbucket has no labels or assignees to change. */
export async function updatePullRequest(cwd: string, url: string, update: PullRequestUpdate): Promise<void> {
  if (update.labels) throw unsupported('labels')
  if (update.assignees) throw unsupported('assignees')
  const a = await access(cwd)
  const pr = await readPullRequest(a, url)
  await repoApi(a, `/pullrequests/${pr.id}`, {
    method: 'PUT',
    body: {
      // Bitbucket wants the title on every update.
      title: update.title ?? pr.title,
      ...(update.body !== undefined ? { description: update.body } : {}),
      ...(update.base !== undefined ? { destination: { branch: { name: update.base } } } : {}),
    },
  })
}

interface RawPipelineRun {
  uuid: string
  state?: { name?: string; result?: { name?: string } }
}

/**
 * Starts the source branch's pipeline again when its latest run failed. Bitbucket Pipelines reruns a whole pipeline,
 * not single steps, so this is one run; a fork's pipelines run in the fork, where this account may not reach.
 */
export async function rerunChecks(cwd: string, url: string): Promise<number> {
  const a = await access(cwd)
  const pr = await readPullRequest(a, url)
  if (isFork(pr)) throw new Error('This pull request comes from a fork, whose pipelines run in the fork.')
  const branch = pr.source.branch.name
  const page = await repoApi<{ values: RawPipelineRun[] }>(
    a,
    `/pipelines/?target.branch=${q(branch)}&sort=-created_on&pagelen=1`,
  )
  const result = page.values[0]?.state?.result?.name
  if (result !== 'FAILED' && result !== 'ERROR') return 0
  await repoApi(a, '/pipelines/', {
    method: 'POST',
    body: { target: { type: 'pipeline_ref_target', ref_type: 'branch', ref_name: branch } },
  })
  return 1
}

registerForgeAdapter({
  id: 'bitbucket',
  repositoryAccount,
  checkAccess,
  pullRequestStatus,
  pullRequestDraft,
  createPullRequest,
  checksFeedback,
  listPullRequests,
  mergeOptions,
  pullRequestAction,
  pullRequestBody,
  pullRequestTimeline,
  pullRequestFiles,
  reviewThreads,
  replyToThread,
  resolveThread,
  requestReviews,
  submitReview,
  // Every top-level comment, on a file or not, is a thread that `reviewThreads` already returns.
  conversation: async () => [],
  comment,
  lineComment,
  editComment,
  deleteComment,
  setThreadStatus,
  react,
  removeReviewers,
  withdrawReview,
  updatePullRequest,
  rerunChecks,
  listIssues,
  issueDetails,
  publishRepository,
  searchRepositories,
})
