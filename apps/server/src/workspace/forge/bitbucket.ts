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
  PublishRepositoryInput,
  PullRequestFeedbackKind,
  PullRequestInfo,
  PullRequestInput,
  PullRequestReviewDecision,
} from '@ramu/shared/types'
import { parseGitlabRemote } from '@ramu/shared/forgeHosts'
import { redactSecrets } from '@ramu/shared/forgeRemote'
import { currentBranch, git, publishRemote } from '../git'
import { registerForgeAdapter } from './adapter'
import { ForgeError, pullRequestDraft } from './github'
import { bitbucketCredential, type BitbucketCredential } from './bitbucketCredentials'

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
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await (target.fetch ?? fetch)(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: authorization(target),
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  }).catch(() => {
    throw new ForgeError('Could not reach Bitbucket. Check the network and try again.', null)
  })
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
  return (text ? JSON.parse(text) : null) as T
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
const repoApi = <T>(a: Access, path = '', init?: { method?: string; body?: unknown }) =>
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

interface RawComment {
  content?: { raw?: string }
  deleted?: boolean
  parent?: unknown
  resolution?: unknown
  inline?: { path?: string; to?: number | null }
  user?: { display_name?: string; nickname?: string }
}

/** Open review comments as a prompt, or null when there are none. */
export function commentsPrompt(pr: PullRequestInfo, comments: RawComment[]): string | null {
  const open = comments.filter((comment) => !comment.deleted && !comment.parent && !comment.resolution)
  const lines = open
    .map((comment) => {
      const text = comment.content?.raw?.trim()
      if (!text) return null
      const where = comment.inline?.path
        ? `${comment.inline.path}${comment.inline.to ? `:${comment.inline.to}` : ''}: `
        : ''
      return `- ${where}${comment.user?.nickname ?? comment.user?.display_name ?? 'reviewer'}: ${text}`
    })
    .filter((line): line is string => !!line)
  if (!lines.length) return null
  return [`Address the open review comments on pull request #${pr.number} (${pr.title}):`, '', ...lines].join('\n')
}

export async function pullRequestFeedback(cwd: string, kind: PullRequestFeedbackKind, url?: string): Promise<string> {
  const a = await access(cwd)
  const raw = await findPullRequest(a, url)
  if (!raw) throw new Error('This branch has no pull request.')
  const pr = parsePullRequest(raw, kind === 'checks' ? await checksOf(a, raw.id) : [])
  if (kind === 'reviews') {
    const comments = await repoApi<{ values: RawComment[] }>(a, `/pullrequests/${raw.id}/comments?pagelen=100`)
    const prompt = commentsPrompt(pr, comments.values)
    if (!prompt) throw new Error('No open review comments.')
    return redactSecrets(prompt)
  }
  const failed = pr.checks.filter((check) => check.state === 'failure')
  if (!failed.length) throw new Error('No failing builds.')
  return redactSecrets(
    [
      `Fix the failing builds on pull request #${pr.number} (${pr.title}). Reproduce each one locally:`,
      '',
      ...failed.map((check) => `- ${check.name}${check.url ? ` (${check.url})` : ''}`),
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

registerForgeAdapter({
  id: 'bitbucket',
  repositoryAccount,
  checkAccess,
  pullRequestStatus,
  pullRequestDraft,
  createPullRequest,
  pullRequestFeedback,
  listIssues,
  issueDetails,
  publishRepository,
  searchRepositories,
})
