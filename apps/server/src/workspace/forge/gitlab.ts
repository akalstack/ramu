// GitLab merge requests, pipelines and issues through the REST API (v4), with a token saved in Settings, the user's
// own `glab` sign-in or a `GITLAB_TOKEN`. Like github.ts, Git runs with argument arrays only; the token is sent only to the project's origin.
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  ForgeAccessReport,
  ForgeAvailability,
  ForgeCheck,
  ForgeCheckResult,
  ForgeCheckState,
  ForgeRepositoryAccount,
  ForgeRepositorySummary,
  ForgeStatus,
  GitlabSummary,
  IssueSummary,
  MergeMethod,
  MergeOptions,
  PublishRepositoryInput,
  PullRequestAction,
  PullRequestList,
  PullRequestSummary,
  PullRequestThread,
  ReviewCommentDraft,
  ReviewVerdict,
  PullRequestInfo,
  PullRequestInput,
  PullRequestReviewDecision,
} from '@ramu/shared/types'
import { glabHosts, parseGitlabRemote, type GitlabProject } from '@ramu/shared/forgeHosts'
import { redactSecrets } from '@ramu/shared/forgeRemote'
import { currentBranch, git, publishRemote } from '../git'
import { registerForgeAdapter } from './adapter'
import { enrichOpen } from './enrich'
import { checksRollup } from '@ramu/shared/pullRequests'
import { findExecutable } from '../../providers/providerBinaries'
import { ForgeError, failureExcerpt, pullRequestDraft } from './github'
import { savedGitlabCredential } from './gitlabCredentials'
import { brokenBranchPrompt } from './buildLogs'

/** Where `glab` keeps its sign-ins: its own config directory, then the platform defaults. */
function glabConfigPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = homedir()
  // An explicit config directory is the only one glab reads, so Ramu reads only it too.
  if (env.GLAB_CONFIG_DIR) return [join(env.GLAB_CONFIG_DIR, 'config.yml')]
  return [
    join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'glab-cli', 'config.yml'),
    join(home, 'Library', 'Application Support', 'glab-cli', 'config.yml'),
  ]
}

/** Every GitLab host the person is signed in to with `glab`, with its token. Never logged or returned to a client. */
export async function gitlabSignIns(env: NodeJS.ProcessEnv = process.env): Promise<Map<string, string>> {
  for (const path of glabConfigPaths(env)) {
    const text = await readFile(path, 'utf8').catch(() => null)
    if (text !== null) return glabHosts(text.slice(0, 256 * 1024))
  }
  return new Map()
}

type TokenSource = 'saved' | 'cli' | 'environment'

/**
 * The token for one origin, and where it came from: the one saved in Settings for it, else `glab`'s, else
 * `GITLAB_TOKEN`, which applies to gitlab.com or to `GITLAB_HOST`.
 */
export async function gitlabToken(
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ token: string; source: TokenSource } | null> {
  const saved = await savedGitlabCredential()
  if (saved?.origin === origin) return { token: saved.token, source: 'saved' }
  const cli = (await gitlabSignIns(env)).get(origin)
  if (cli) return { token: cli, source: 'cli' }
  const named = (env.GITLAB_HOST ?? 'gitlab.com')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .toLowerCase()
  const token = env.GITLAB_TOKEN ?? env.GL_TOKEN
  return token && named === origin ? { token, source: 'environment' } : null
}

/** The GitLab servers this host can use and, when asked to check, who each sign-in is. */
export async function gitlabSummary(
  check: boolean,
  options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; hasCli?: boolean } = {},
): Promise<GitlabSummary> {
  const env = options.env ?? process.env
  const found = new Map<string, { token: string; source: TokenSource }>()
  const saved = await savedGitlabCredential()
  if (saved) found.set(saved.origin, { token: saved.token, source: 'saved' })
  for (const [origin, token] of await gitlabSignIns(env))
    if (!found.has(origin)) found.set(origin, { token, source: 'cli' })
  const environment = env.GITLAB_TOKEN ?? env.GL_TOKEN
  if (environment) {
    const origin = (env.GITLAB_HOST ?? 'gitlab.com')
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '')
      .toLowerCase()
    if (!found.has(origin)) found.set(origin, { token: environment, source: 'environment' })
  }
  const accounts = await Promise.all(
    [...found].map(async ([origin, { token, source }]) => {
      if (!check) return { origin, source, login: null, state: 'unchecked' as const }
      try {
        const user = await gitlabApi<{ username?: string }>({ origin, token, fetch: options.fetch ?? fetch }, '/user')
        return { origin, source, login: user?.username ?? null, state: 'ok' as const }
      } catch (error) {
        return {
          origin,
          source,
          login: null,
          state: 'failed' as const,
          error: redactSecrets(String((error as Error).message)),
        }
      }
    }),
  )
  return { cli: (options.hasCli ?? findExecutable('glab') !== null) ? 'installed' : 'no-cli', accounts }
}

/** Self-managed GitLab servers the person has signed in to, so their remotes are recognised as GitLab. */
export async function knownGitlabHosts(): Promise<Set<string>> {
  const hosts = new Set((await gitlabSignIns()).keys())
  const saved = await savedGitlabCredential()
  if (saved) hosts.add(saved.origin)
  if (process.env.GITLAB_HOST) hosts.add(process.env.GITLAB_HOST.replace(/^https?:\/\//, '').toLowerCase())
  return hosts
}

/** The GitLab project behind a checkout's publish remote. */
export async function gitlabProjectOf(cwd: string): Promise<GitlabProject | null> {
  try {
    const { remote } = await publishRemote(cwd, await currentBranch(cwd))
    return remote ? parseGitlabRemote((await git(cwd, ['remote', 'get-url', remote])).trim()) : null
  } catch {
    return null
  }
}

interface Access {
  cwd: string
  project: GitlabProject
  token: string
  source: TokenSource
  fetch: typeof fetch
}

const encode = (path: string) => encodeURIComponent(path)

async function access(cwd: string, request: typeof fetch = fetch): Promise<Access> {
  const project = await gitlabProjectOf(cwd)
  if (!project) throw new ForgeError('This repository has no GitLab remote.', 'no-remote')
  const found = await gitlabToken(project.origin)
  if (!found)
    throw new ForgeError(
      `Sign in to ${project.origin} with glab (glab auth login), or set GITLAB_TOKEN, to use merge requests here.`,
      'signed-out',
    )
  return { cwd, project, ...found, fetch: request }
}

/** One API request. Bounded in time and size; errors never echo the token or the response body. */
export async function gitlabApi<T>(
  target: Pick<Access, 'token' | 'fetch'> & { origin: string },
  path: string,
  init: { method?: string; body?: unknown; text?: boolean } = {},
): Promise<T> {
  const response = await target
    .fetch(`https://${target.origin}/api/v4${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'PRIVATE-TOKEN': target.token,
        Accept: init.text ? 'text/plain' : 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    })
    .catch(() => {
      throw new ForgeError(`Could not reach ${target.origin}. Check the network and try again.`, null)
    })
  if (response.status === 401)
    throw new ForgeError(`The GitLab sign-in for ${target.origin} expired. Sign in again with glab.`, 'signed-out')
  if (response.status === 403) throw new ForgeError('This GitLab account does not have permission for that.', null)
  if (response.status === 404)
    throw new ForgeError('GitLab could not find that project, or this account cannot see it.', null)
  if (!response.ok) throw new ForgeError(`GitLab answered ${response.status}. Try again in a moment.`, null)
  const text = await response.text()
  if (text.length > 8 * 1024 * 1024) throw new ForgeError('GitLab sent more than Ramu reads at once.', null)
  // Job logs are plain text; everything else is JSON.
  if (init.text) return text as T
  return (text ? JSON.parse(text) : null) as T
}

const projectApi = <T = unknown>(a: Access, path = '', init?: { method?: string; body?: unknown }) =>
  gitlabApi<T>({ ...a, origin: a.project.origin }, `/projects/${encode(a.project.path)}${path}`, init)

/**
 * Turns on the project's "Pipelines must succeed" merge setting, so a merge request cannot merge while CI fails.
 * Nothing else in the project's settings is changed.
 */
export async function requirePipeline(cwd: string, request: typeof fetch = fetch): Promise<'required' | 'already'> {
  const a = await access(cwd, request)
  const project = await projectApi<{ only_allow_merge_if_pipeline_succeeds?: boolean } | null>(a)
  if (project?.only_allow_merge_if_pipeline_succeeds) return 'already'
  await projectApi(a, '', { method: 'PUT', body: { only_allow_merge_if_pipeline_succeeds: true } })
  return 'required'
}

interface RawMergeRequest {
  iid: number
  title: string
  web_url: string
  state: 'opened' | 'closed' | 'merged' | 'locked'
  draft?: boolean
  work_in_progress?: boolean
  target_branch: string
  source_branch: string
  sha?: string
  detailed_merge_status?: string
}

interface RawJob {
  id: number
  name: string
  status: string
  allow_failure?: boolean
  web_url?: string
}

/** Pipeline job states as check states. A failure the pipeline allows does not fail the merge request. */
export function jobState(job: Pick<RawJob, 'status' | 'allow_failure'>): ForgeCheckState {
  if (job.status === 'success') return 'success'
  if (job.status === 'failed') return job.allow_failure ? 'skipped' : 'failure'
  if (job.status === 'skipped' || job.status === 'canceled' || job.status === 'manual') return 'skipped'
  return 'pending'
}

/** The latest run of each job; a retried job replaces its earlier attempt. */
export function parseJobs(jobs: RawJob[]): ForgeCheck[] {
  const latest = new Map<string, RawJob>()
  for (const job of jobs) if ((latest.get(job.name)?.id ?? -1) < job.id) latest.set(job.name, job)
  return [...latest.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((job) => ({ name: job.name, state: jobState(job), url: job.web_url ?? null }))
}

function reviewDecision(status: string | undefined, approved: boolean): PullRequestReviewDecision {
  if (status === 'requested_changes') return 'changes-requested'
  if (approved) return 'approved'
  if (status === 'not_approved') return 'review-required'
  return null
}

export function parseMergeRequest(raw: RawMergeRequest, approved: boolean, checks: ForgeCheck[]): PullRequestInfo {
  return {
    number: raw.iid,
    title: raw.title,
    url: raw.web_url,
    state: raw.state === 'merged' ? 'merged' : raw.state === 'opened' ? 'open' : 'closed',
    draft: Boolean(raw.draft ?? raw.work_in_progress),
    baseBranch: raw.target_branch,
    headBranch: raw.source_branch,
    ...(raw.sha ? { headCommit: raw.sha } : {}),
    reviewDecision: reviewDecision(raw.detailed_merge_status, approved),
    checks,
  }
}

/** The merge request `url` names, or the newest one for the checked-out branch. */
async function mergeRequest(a: Access, url?: string): Promise<RawMergeRequest | null> {
  const iid = url ? /\/-\/merge_requests\/(\d+)/.exec(url)?.[1] : undefined
  if (iid) return projectApi(a, `/merge_requests/${iid}`) as Promise<RawMergeRequest>
  const branch = await currentBranch(a.cwd)
  if (!branch) return null
  const list = (await projectApi(
    a,
    `/merge_requests?source_branch=${encode(branch)}&state=all&order_by=updated_at&per_page=1`,
  )) as RawMergeRequest[]
  return list[0] ?? null
}

async function checksOf(a: Access, iid: number): Promise<ForgeCheck[]> {
  const pipelines = (await projectApi(a, `/merge_requests/${iid}/pipelines?per_page=1`)) as { id: number }[]
  const pipeline = pipelines[0]
  if (!pipeline) return []
  return parseJobs(
    (await projectApi(a, `/pipelines/${pipeline.id}/jobs?per_page=100&include_retried=true`)) as RawJob[],
  )
}

export async function pullRequestStatus(cwd: string, url?: string): Promise<ForgeStatus> {
  let a: Access
  try {
    a = await access(cwd)
  } catch (error) {
    if (error instanceof ForgeError && error.availability)
      return { availability: error.availability, service: 'gitlab', pullRequest: null }
    throw error
  }
  const raw = await mergeRequest(a, url)
  if (!raw) return { availability: 'ready', service: 'gitlab', pullRequest: null }
  const [approvals, checks] = await Promise.all([
    (projectApi(a, `/merge_requests/${raw.iid}/approvals`) as Promise<{ approved?: boolean }>).catch(() => ({
      approved: false,
    })),
    checksOf(a, raw.iid).catch(() => []),
  ])
  return {
    availability: 'ready',
    service: 'gitlab',
    pullRequest: parseMergeRequest(raw, approvals.approved === true, checks),
  }
}

export async function createPullRequest(cwd: string, input: PullRequestInput): Promise<ForgeStatus> {
  const branch = await currentBranch(cwd)
  if (!branch) throw new Error('Switch to a branch before opening a merge request.')
  const a = await access(cwd)
  const title = input.draft && !/^draft:/i.test(input.title) ? `Draft: ${input.title}` : input.title
  try {
    await gitlabApi({ ...a, origin: a.project.origin }, `/projects/${encode(a.project.path)}/merge_requests`, {
      method: 'POST',
      body: { source_branch: branch, target_branch: input.base, title, description: input.body },
    })
  } catch (error) {
    // A lost reply does not say whether it was created; look before reporting, so a retry never opens a duplicate.
    const existing = await pullRequestStatus(cwd).catch(() => null)
    if (existing?.pullRequest?.state === 'open' && existing.pullRequest.baseBranch === input.base) return existing
    throw error
  }
  return pullRequestStatus(cwd)
}

/** One section per failed job, with the end of its trace. */
async function failedJobSections(a: Access, failed: ForgeCheck[]): Promise<string[]> {
  const sections: string[] = []
  for (const check of failed.slice(0, 5)) {
    const id = check.url ? /\/-\/jobs\/(\d+)/.exec(check.url)?.[1] : undefined
    const log = id
      ? await gitlabApi<string>(
          { ...a, origin: a.project.origin },
          `/projects/${encode(a.project.path)}/jobs/${id}/trace`,
          { text: true },
        )
          .then((text) => (typeof text === 'string' ? text : ''))
          .catch(() => '')
      : ''
    sections.push(`### ${check.name}\n${log ? failureExcerpt(log) : 'No log available.'}`)
  }
  return sections
}

export async function checksFeedback(cwd: string, url?: string): Promise<string> {
  const a = await access(cwd)
  const raw = await mergeRequest(a, url)
  if (!raw) throw new Error('This branch has no merge request.')
  const mr = parseMergeRequest(raw, false, await checksOf(a, raw.iid))
  const failed = mr.checks.filter((check) => check.state === 'failure')
  if (!failed.length) throw new Error('No failing pipeline jobs.')
  return redactSecrets(
    [
      `Fix the failing pipeline jobs on merge request !${mr.number} (${mr.title}):`,
      '',
      ...(await failedJobSections(a, failed)),
    ].join('\n'),
  )
}

async function pipelineJobs(a: Access, sha: string): Promise<ForgeCheck[]> {
  const pipelines = (await projectApi(a, `/pipelines?sha=${encode(sha)}&per_page=1`)) as { id: number }[]
  const pipeline = pipelines[0]
  if (!pipeline) return []
  return parseJobs(
    (await projectApi(a, `/pipelines/${pipeline.id}/jobs?per_page=100&include_retried=true`)) as RawJob[],
  )
}

/** The latest pipeline's jobs on one commit, such as a push to the default branch. */
export async function commitChecks(cwd: string, sha: string): Promise<ForgeCheck[]> {
  return pipelineJobs(await access(cwd), sha)
}

export async function commitChecksFeedback(cwd: string, sha: string, branch: string): Promise<string> {
  const a = await access(cwd)
  const failed = (await pipelineJobs(a, sha)).filter((check) => check.state === 'failure')
  if (!failed.length) throw new Error(`No pipeline jobs are failing on ${sha.slice(0, 7)}.`)
  return redactSecrets(brokenBranchPrompt(sha, branch, await failedJobSections(a, failed)))
}

interface RawIssue {
  iid: number
  title: string
  web_url: string
  labels?: string[]
  updated_at?: string
  description?: string | null
}

export async function listIssues(cwd: string, search: string): Promise<IssueSummary[]> {
  const a = await access(cwd)
  const query = search.trim() ? `&search=${encode(search.trim())}` : ''
  const issues = (await projectApi(a, `/issues?state=opened&order_by=updated_at&per_page=30${query}`)) as RawIssue[]
  return issues.map((issue) => ({
    number: issue.iid,
    title: issue.title,
    url: issue.web_url,
    labels: issue.labels ?? [],
    updatedAt: issue.updated_at ? Date.parse(issue.updated_at) : 0,
  }))
}

export async function issueDetails(cwd: string, number: number) {
  const a = await access(cwd)
  const issue = (await projectApi(a, `/issues/${number}`)) as RawIssue
  const body = (issue.description ?? '').trim().slice(0, 20_000)
  return {
    title: issue.title,
    url: issue.web_url,
    prompt: redactSecrets(
      `Work on GitLab issue #${issue.iid}: ${issue.title}\n${issue.web_url}${body ? `\n\n${body}` : ''}`,
    ),
  }
}

interface RawProject {
  path_with_namespace: string
  description: string | null
  visibility: 'private' | 'internal' | 'public'
  http_url_to_repo: string
  last_activity_at?: string
}

export function parseProjects(raw: RawProject[]): ForgeRepositorySummary[] {
  return raw
    .filter((project) => project.http_url_to_repo?.startsWith('https://'))
    .map((project) => ({
      fullName: project.path_with_namespace,
      description: project.description || null,
      private: project.visibility !== 'public',
      cloneUrl: project.http_url_to_repo,
      updatedAt: project.last_activity_at ? Date.parse(project.last_activity_at) : 0,
    }))
}

export async function searchRepositories(
  search: string,
  _cwd?: string,
  origin = 'gitlab.com',
): Promise<ForgeRepositorySummary[]> {
  const found = await gitlabToken(origin)
  if (!found)
    throw new ForgeError(`Sign in to ${origin} with glab, or set GITLAB_TOKEN, to list projects.`, 'signed-out')
  const query = search.trim() ? `&search=${encode(search.trim())}` : ''
  return parseProjects(
    await gitlabApi<RawProject[]>(
      { origin, token: found.token, fetch },
      `/projects?membership=true&simple=true&order_by=last_activity_at&per_page=30${query}`,
    ),
  )
}

export async function publishRepository(cwd: string, input: PublishRepositoryInput): Promise<void> {
  const remotes = (await git(cwd, ['remote'])).trim().split('\n').filter(Boolean)
  if (remotes.includes('origin')) throw new Error('This repository already has an origin remote.')
  const origin = process.env.GITLAB_HOST?.replace(/^https?:\/\//, '').toLowerCase() || 'gitlab.com'
  const found = await gitlabToken(origin)
  if (!found) throw new ForgeError(`Sign in to ${origin} with glab, or set GITLAB_TOKEN, to publish.`, 'signed-out')
  const target = { origin, token: found.token, fetch }
  const [namespace, name] = input.name.includes('/')
    ? [input.name.slice(0, input.name.lastIndexOf('/')), input.name.slice(input.name.lastIndexOf('/') + 1)]
    : [null, input.name]
  const namespaceId = namespace
    ? (await gitlabApi<{ id: number }>(target, `/namespaces/${encode(namespace)}`)).id
    : undefined
  const project = await gitlabApi<RawProject>(target, '/projects', {
    method: 'POST',
    body: { name, path: name, visibility: input.visibility, ...(namespaceId ? { namespace_id: namespaceId } : {}) },
  })
  await git(cwd, ['remote', 'add', 'origin', project.http_url_to_repo])
  await git(cwd, ['push', '-u', 'origin', 'HEAD'])
}

export async function repositoryAccount(cwd: string): Promise<ForgeRepositoryAccount> {
  const project = await gitlabProjectOf(cwd)
  if (!project) return { origin: null, login: null, source: 'none', ambiguous: false }
  const found = await gitlabToken(project.origin)
  if (!found) return { origin: project.origin, login: null, source: 'none', ambiguous: false }
  const user = await gitlabApi<{ username?: string }>({ origin: project.origin, token: found.token, fetch }, '/user')
    .then((value) => value.username ?? null)
    .catch(() => null)
  return { origin: project.origin, login: user, source: found.source === 'saved' ? 'saved' : 'cli', ambiguous: false }
}

const unknown = (detail: string | null = null): ForgeCheckResult => ({ state: 'unknown', detail })

/** Developer (30) or higher can push and open merge requests. */
const WRITE_LEVEL = 30

export async function checkAccess(cwd: string): Promise<ForgeAccessReport> {
  const checkedAt = Date.now()
  const project = await gitlabProjectOf(cwd)
  const none = { source: 'none' as const, login: null, connectionId: null, ambiguous: false }
  if (!project)
    return {
      origin: null,
      account: none,
      api: { read: unknown('This repository has no GitLab remote.'), write: unknown() },
      transport: unknown(),
      checkedAt,
    }
  const found = await gitlabToken(project.origin)
  const transport = await git(cwd, ['ls-remote', '--exit-code', '--heads', 'origin'])
    .then((): ForgeCheckResult => ({ state: 'ok', detail: null }))
    .catch((): ForgeCheckResult => ({
      state: 'failed',
      detail: 'Git could not reach the remote with this host’s Git credentials.',
    }))
  if (!found)
    return {
      origin: project.origin,
      account: none,
      api: {
        read: unknown('Save a GitLab token in Settings → Git, sign in with glab, or set GITLAB_TOKEN.'),
        write: unknown(),
      },
      transport,
      checkedAt,
    }
  const target = { origin: project.origin, token: found.token, fetch }
  const login = await gitlabApi<{ username?: string }>(target, '/user')
    .then((user) => user.username ?? null)
    .catch(() => null)
  const account = {
    source: found.source === 'saved' ? ('saved' as const) : ('cli' as const),
    login,
    connectionId: null,
    ambiguous: false,
  }
  try {
    const details = await gitlabApi<{
      permissions?: { project_access?: { access_level: number } | null; group_access?: { access_level: number } | null }
    }>(target, `/projects/${encode(project.path)}`)
    const level = Math.max(
      details.permissions?.project_access?.access_level ?? 0,
      details.permissions?.group_access?.access_level ?? 0,
    )
    return {
      origin: project.origin,
      account,
      api: {
        read: { state: 'ok', detail: null },
        write:
          level >= WRITE_LEVEL
            ? { state: 'ok', detail: null }
            : { state: 'denied', detail: 'This account cannot push or open merge requests here.' },
      },
      transport,
      checkedAt,
    }
  } catch (error) {
    return {
      origin: project.origin,
      account,
      api: { read: { state: 'denied', detail: error instanceof Error ? error.message : null }, write: unknown() },
      transport,
      checkedAt,
    }
  }
}

// ---- Merge request lists, actions and review threads ----

interface RawUser {
  id: number
  username: string
  bot?: boolean
}

interface RawListMergeRequest extends RawMergeRequest {
  author?: RawUser | null
  reviewers?: RawUser[]
  updated_at?: string
  source_project_id?: number
  target_project_id?: number
  has_conflicts?: boolean
}

/** What merging into a merge request's target is held up by, from `detailed_merge_status`. */
export function gitlabMergeability(raw: Pick<RawListMergeRequest, 'detailed_merge_status' | 'has_conflicts'>) {
  const status = raw.detailed_merge_status
  if (raw.has_conflicts || status === 'conflict') return 'conflicts' as const
  if (status === 'mergeable') return 'clean' as const
  if (status === 'need_rebase') return 'behind' as const
  // Still being computed, or a state the list shows on its own (draft, closed).
  if (
    !status ||
    ['checking', 'unchecked', 'preparing', 'approvals_syncing', 'draft_status', 'not_open'].includes(status)
  )
    return 'unknown' as const
  return 'blocked' as const
}

const isFork = (raw: Pick<RawListMergeRequest, 'source_project_id' | 'target_project_id'>) =>
  raw.source_project_id !== undefined && raw.source_project_id !== raw.target_project_id

/**
 * One merge request as a list row. The list call carries no pipeline or approval state, so checks are unknown and
 * approval shows only through `detailed_merge_status`.
 */
export function parseListMergeRequest(raw: RawListMergeRequest, viewer: string | null): PullRequestSummary {
  const author = raw.author?.username ?? null
  const reviewers = (raw.reviewers ?? []).map((reviewer) => reviewer.username)
  const me = viewer?.toLowerCase()
  return {
    ...parseMergeRequest(raw, false, []),
    author,
    fork: isFork(raw),
    checks: null,
    mergeable: gitlabMergeability(raw),
    openThreads: null,
    requestedReviewers: reviewers,
    group:
      me && author?.toLowerCase() === me
        ? 'mine'
        : me && reviewers.some((name) => name.toLowerCase() === me)
          ? 'review'
          : 'other',
    updatedAt: raw.updated_at ? Date.parse(raw.updated_at) || 0 : 0,
  }
}

/** What a list row lacks: the head pipeline's state, whether it is approved, and its unresolved threads. */
export async function mergeRequestDetails(a: Access, iid: number): Promise<Partial<PullRequestSummary>> {
  const [one, approvals, discussions] = await Promise.all([
    projectApi<{ head_pipeline?: { status?: string } | null; detailed_merge_status?: string }>(
      a,
      `/merge_requests/${iid}`,
    ),
    projectApi<{ approved?: boolean }>(a, `/merge_requests/${iid}/approvals`).catch(() => null),
    projectApi<RawDiscussion[]>(a, `/merge_requests/${iid}/discussions?per_page=100`).catch(() => null),
  ])
  const pipeline = one.head_pipeline?.status
  return {
    checks: pipeline ? checksRollup([{ state: jobState({ status: pipeline, allow_failure: false }) }]) : null,
    reviewDecision: reviewDecision(one.detailed_merge_status, approvals?.approved === true),
    ...(discussions
      ? {
          openThreads: discussions.filter((discussion) => {
            const first = discussion.notes.find((note) => !note.system)
            return first?.resolvable && !first.resolved
          }).length,
        }
      : {}),
  }
}

const viewerOf = (a: Access) =>
  gitlabApi<{ id?: number; username?: string }>({ ...a, origin: a.project.origin }, '/user').catch(() => null)

export async function listPullRequests(cwd: string, options: { includeClosed: boolean }): Promise<PullRequestList> {
  const unavailable = (availability: ForgeAvailability): PullRequestList => ({
    availability,
    service: 'gitlab',
    viewer: null,
    pullRequests: [],
  })
  try {
    const a = await access(cwd)
    const list = (state: string, count: number) =>
      projectApi<RawListMergeRequest[]>(a, `/merge_requests?state=${state}&order_by=updated_at&per_page=${count}`)
    const [user, open, merged, closed] = await Promise.all([
      viewerOf(a),
      list('opened', 50),
      options.includeClosed ? list('merged', 30) : [],
      options.includeClosed ? list('closed', 30) : [],
    ])
    const viewer = user?.username ?? null
    const done = [...merged, ...closed]
      .sort((x, y) => (Date.parse(y.updated_at ?? '') || 0) - (Date.parse(x.updated_at ?? '') || 0))
      .slice(0, 30)
    return {
      availability: 'ready',
      service: 'gitlab',
      viewer,
      pullRequests: await enrichOpen(
        [...open, ...done].map((raw) => parseListMergeRequest(raw, viewer)),
        (pr) => mergeRequestDetails(a, pr.number),
      ),
    }
  } catch (error) {
    if (error instanceof ForgeError && error.availability) return unavailable(error.availability)
    throw error
  }
}

function iidOf(url: string): number {
  const match = /\/-\/merge_requests\/(\d+)(?:[/?#]|$)/.exec(url)
  if (!match) throw new Error('That is not a GitLab merge request link.')
  return Number(match[1])
}

interface RawOneMergeRequest extends RawListMergeRequest {
  description?: string | null
  force_remove_source_branch?: boolean | null
  head_pipeline?: { status?: string } | null
  user?: { can_merge?: boolean }
  diff_refs?: { base_sha: string; start_sha: string; head_sha: string } | null
}

interface RawProjectSettings {
  merge_method?: 'merge' | 'rebase_merge' | 'ff'
  squash_option?: 'never' | 'always' | 'default_on' | 'default_off'
}

const readMergeRequest = (a: Access, url: string) => projectApi<RawOneMergeRequest>(a, `/merge_requests/${iidOf(url)}`)

const BLOCKED_BY: Record<string, string> = {
  not_approved: 'It needs approval before it can merge.',
  requested_changes: 'A reviewer requested changes.',
  discussions_not_resolved: 'Every discussion must be resolved first.',
  ci_must_pass: 'The pipeline must succeed first.',
  ci_still_running: 'The pipeline is still running.',
  blocked_status: 'Another merge request it depends on has to merge first.',
  external_status_checks: 'External status checks have not passed.',
  status_checks_must_pass: 'External status checks have not passed.',
  jira_association_missing: 'The title or description must name a Jira issue.',
  security_policy_violations: 'A security policy is blocking it.',
  locked_paths: 'It changes paths another user has locked.',
  locked_lfs_files: 'It changes LFS files another user has locked.',
  title_regex: 'Its title does not match the format the project requires.',
}

/**
 * GitLab merges with the project's own method (merge commit, semi-linear or fast-forward); squashing is the one choice
 * per merge request. So the methods are the project's method plus squash, unless the project forbids or forces it.
 */
export function gitlabMergeOptions(project: RawProjectSettings, mr: RawOneMergeRequest): MergeOptions {
  const squash = project.squash_option ?? 'default_off'
  const own: MergeMethod = project.merge_method === 'ff' ? 'rebase' : 'merge'
  const methods: MergeMethod[] = squash === 'always' ? ['squash'] : squash === 'never' ? [own] : ['squash', own]
  const blockers: string[] = []
  if (mr.state !== 'opened') blockers.push('This merge request is not open.')
  if (mr.draft ?? mr.work_in_progress) blockers.push('It is a draft. Mark it ready for review first.')
  const merge = gitlabMergeability(mr)
  if (merge === 'conflicts') blockers.push('It has conflicts with its target branch.')
  if (merge === 'behind') blockers.push('It must be rebased onto its target branch, which this project requires.')
  const status = mr.detailed_merge_status ?? ''
  if (merge === 'blocked') blockers.push(BLOCKED_BY[status] ?? 'GitLab reports it cannot merge yet.')
  if (mr.head_pipeline?.status === 'failed' && status !== 'ci_must_pass') blockers.push('Some checks are failing.')
  if (mr.user?.can_merge === false) blockers.push('This account cannot merge into this project.')
  return { methods, blockers, canDeleteBranch: !isFork(mr) && !mr.force_remove_source_branch }
}

export async function mergeOptions(cwd: string, url: string): Promise<MergeOptions> {
  const a = await access(cwd)
  const [project, mr] = await Promise.all([projectApi<RawProjectSettings>(a), readMergeRequest(a, url)])
  return gitlabMergeOptions(project, mr)
}

const DRAFT_PREFIX = /^\s*(?:\[draft\]|\(draft\)|draft:|\[wip\]|wip:)\s*/i

/** GitLab marks a merge request a draft by its title, so marking it ready removes the prefix. */
export const readyTitle = (title: string) => title.replace(DRAFT_PREFIX, '')

/** Merge, close, reopen, mark ready or rebase. A merge whose reply is lost is checked before it fails. */
export async function pullRequestAction(cwd: string, url: string, action: PullRequestAction): Promise<void> {
  const a = await access(cwd)
  const mr = await readMergeRequest(a, url)
  const path = `/merge_requests/${mr.iid}`
  switch (action.kind) {
    case 'merge':
      try {
        await projectApi(a, `${path}/merge`, {
          method: 'PUT',
          body: {
            squash: action.method === 'squash',
            should_remove_source_branch: action.deleteBranch && !isFork(mr),
            merge_when_pipeline_succeeds: false,
            ...(mr.sha ? { sha: mr.sha } : {}),
          },
        })
      } catch (error) {
        const after = await readMergeRequest(a, url).catch(() => null)
        if (after?.state !== 'merged') throw error
      }
      return
    case 'close':
    case 'reopen':
      await projectApi(a, path, { method: 'PUT', body: { state_event: action.kind } })
      return
    case 'ready':
      if (DRAFT_PREFIX.test(mr.title))
        await projectApi(a, path, { method: 'PUT', body: { title: readyTitle(mr.title) } })
      return
    case 'update-branch':
      await projectApi(a, `${path}/rebase`, { method: 'PUT' })
      return
  }
}

export async function pullRequestBody(cwd: string, url: string): Promise<string> {
  return (await readMergeRequest(await access(cwd), url)).description ?? ''
}

interface RawDiscussionNote {
  id: number
  body: string
  system?: boolean
  resolvable?: boolean
  resolved?: boolean
  created_at?: string
  author?: RawUser
  position?: { new_path?: string | null; old_path?: string | null; new_line?: number | null; old_line?: number | null }
}

interface RawDiscussion {
  id: string
  notes: RawDiscussionNote[]
}

const isBotName = (name: string) => /(?:^|_)bot(?:_|\d|$)|\[bot\]$/i.test(name)

/**
 * Every discussion with a person's note in it. Resolvable ones are review threads; general comments come as threads
 * that cannot be resolved. A note is trusted from the author, reviewers, members with Developer access or more, and
 * bots. GitLab does not report whether a diff note is outdated, so none is marked outdated.
 */
export function parseDiscussions(
  discussions: RawDiscussion[],
  mr: Pick<RawListMergeRequest, 'author' | 'reviewers'>,
  developers: Set<number>,
): PullRequestThread[] {
  const known = new Set(
    [mr.author?.username, ...(mr.reviewers ?? []).map((reviewer) => reviewer.username)]
      .filter((name): name is string => !!name)
      .map((name) => name.toLowerCase()),
  )
  return discussions.flatMap((discussion) => {
    const notes = discussion.notes.filter((note) => !note.system)
    const first = notes[0]
    if (!first) return []
    const resolvable = notes.filter((note) => note.resolvable)
    return [
      {
        id: discussion.id,
        path: first.position?.new_path ?? first.position?.old_path ?? null,
        line: first.position?.new_line ?? first.position?.old_line ?? null,
        outdated: false,
        resolved: resolvable.length > 0 && resolvable.every((note) => note.resolved),
        resolvable: resolvable.length > 0,
        comments: notes.map((note) => {
          const login = note.author?.username ?? null
          const bot = note.author?.bot === true || (!!login && isBotName(login))
          return {
            id: String(note.id),
            author: login,
            bot,
            trusted:
              bot ||
              (!!login && known.has(login.toLowerCase())) ||
              (note.author !== undefined && developers.has(note.author.id)),
            body: note.body.trim(),
            createdAt: note.created_at ? Date.parse(note.created_at) || 0 : 0,
          }
        }),
      },
    ]
  })
}

export async function reviewThreads(cwd: string, url: string): Promise<PullRequestThread[]> {
  const a = await access(cwd)
  const iid = iidOf(url)
  const [mr, discussions] = await Promise.all([
    readMergeRequest(a, url),
    projectApi<RawDiscussion[]>(a, `/merge_requests/${iid}/discussions?per_page=100`),
  ])
  const ids = [
    ...new Set(discussions.flatMap((discussion) => discussion.notes.map((note) => note.author?.id ?? -1))),
  ].filter((id) => id >= 0)
  const members = ids.length
    ? await projectApi<{ id: number; access_level: number }[]>(
        a,
        `/members/all?per_page=100&${ids.map((id) => `user_ids[]=${id}`).join('&')}`,
      ).catch(() => [])
    : []
  const developers = new Set(members.filter((member) => member.access_level >= WRITE_LEVEL).map((member) => member.id))
  return parseDiscussions(discussions, mr, developers)
}

export async function replyToThread(cwd: string, url: string, threadId: string, body: string): Promise<string> {
  const a = await access(cwd)
  const note = await projectApi<{ id: number }>(
    a,
    `/merge_requests/${iidOf(url)}/discussions/${encode(threadId)}/notes`,
    { method: 'POST', body: { body } },
  )
  return String(note.id)
}

export async function resolveThread(cwd: string, url: string, threadId: string): Promise<void> {
  const a = await access(cwd)
  const path = `/merge_requests/${iidOf(url)}/discussions/${encode(threadId)}`
  const discussion = await projectApi<RawDiscussion>(a, path)
  if (!discussion.notes.some((note) => note.resolvable)) return
  await projectApi(a, path, { method: 'PUT', body: { resolved: true } })
}

/** Adds the named users as reviewers, keeping the ones already there. */
export async function requestReviews(cwd: string, url: string, reviewers: string[]): Promise<void> {
  if (!reviewers.length) return
  const a = await access(cwd)
  const mr = await readMergeRequest(a, url)
  const target = { ...a, origin: a.project.origin }
  const found = await Promise.all(
    reviewers.map(async (name) => {
      const existing = mr.reviewers?.find((reviewer) => reviewer.username.toLowerCase() === name.toLowerCase())
      if (existing) return existing.id
      const [user] = await gitlabApi<{ id: number }[]>(target, `/users?username=${encode(name)}`)
      if (!user) throw new Error(`GitLab has no user named ${name}.`)
      return user.id
    }),
  )
  const ids = [...new Set([...(mr.reviewers ?? []).map((reviewer) => reviewer.id), ...found])]
  await projectApi(a, `/merge_requests/${mr.iid}`, { method: 'PUT', body: { reviewer_ids: ids } })
}

/**
 * Inline comments as diff discussions on the current version, the summary as a note, then the approval. GitLab's API
 * has no "request changes" verdict, so that review posts its comments and summary without approving.
 */
export async function submitReview(
  cwd: string,
  url: string,
  review: { verdict: ReviewVerdict; body: string; comments: ReviewCommentDraft[] },
): Promise<void> {
  const a = await access(cwd)
  const mr = await readMergeRequest(a, url)
  const path = `/merge_requests/${mr.iid}`
  const refs = mr.diff_refs
  if (review.comments.length && !refs) throw new Error('GitLab has not prepared this merge request’s diff yet.')
  for (const comment of review.comments)
    await projectApi(a, `${path}/discussions`, {
      method: 'POST',
      body: {
        body: comment.body,
        position: {
          position_type: 'text',
          base_sha: refs!.base_sha,
          start_sha: refs!.start_sha,
          head_sha: refs!.head_sha,
          old_path: comment.path,
          new_path: comment.path,
          new_line: comment.line,
        },
      },
    })
  if (review.body.trim()) await projectApi(a, `${path}/notes`, { method: 'POST', body: { body: review.body } })
  if (review.verdict === 'approve')
    await projectApi(a, `${path}/approve`, { method: 'POST', body: mr.sha ? { sha: mr.sha } : {} })
}

/** GitLab behind the shared adapter boundary, chosen for checkouts whose remote is a GitLab server. */
registerForgeAdapter({
  id: 'gitlab',
  repositoryAccount,
  checkAccess,
  pullRequestStatus,
  pullRequestDraft,
  createPullRequest,
  checksFeedback,
  commitChecks,
  commitChecksFeedback,
  listPullRequests,
  mergeOptions,
  pullRequestAction,
  pullRequestBody,
  reviewThreads,
  replyToThread,
  resolveThread,
  requestReviews,
  submitReview,
  listIssues,
  issueDetails,
  publishRepository,
  searchRepositories,
})
