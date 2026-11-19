// GitLab merge requests, pipelines and issues through the REST API (v4), with a token saved in Settings, the user's
// own `glab` sign-in or a `GITLAB_TOKEN`. Like github.ts, Git runs with argument arrays only; the token is sent only to the project's origin.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
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
  PullRequestReaction,
  PullRequestSide,
  PullRequestThreadStatus,
  PullRequestUpdate,
} from '@ramu/shared/types'
import { unsupportedPullRequestText } from '@ramu/shared/pullRequestSupport'
import { glabHosts, parseGitlabRemote, type GitlabProject } from '@ramu/shared/forgeHosts'
import { redactSecrets } from '@ramu/shared/forgeRemote'
import { currentBranch, git, publishRemote } from '../git'
import { FILES_PAGE, TIMELINE_LENGTH, boundedPatch, opening, registerForgeAdapter } from './adapter'
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

/** A token and how GitLab expects it: OAuth tokens from glab's web sign-in go as bearer tokens. */
interface GitlabAuth {
  token: string
  oauth?: boolean
}

/** Runs `glab` with an argument array and no prompts; resolves to its output, or null when it fails. */
function glab(executable: string, args: string[], env: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      executable,
      args,
      { encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024, env: { ...env, NO_PROMPT: '1', NO_COLOR: '1' } },
      (error, stdout) => resolve(error ? null : stdout),
    )
  })
}

/** Leaves room for a request to finish before an OAuth token expires. */
const EXPIRY_MARGIN_MS = 2 * 60_000
const signInCache = new Map<string, { auth: GitlabAuth; until: number }>()

/**
 * Every GitLab host the person is signed in to with `glab`, with its token. A token glab keeps in the OS keyring is
 * asked of glab, and an OAuth token near its expiry is refreshed by glab first, so a web sign-in keeps working. Never
 * logged or returned to a client.
 */
export async function gitlabSignIns(
  env: NodeJS.ProcessEnv = process.env,
  executable: string | null = findExecutable('glab'),
): Promise<Map<string, GitlabAuth>> {
  let text: string | null = null
  for (const path of glabConfigPaths(env)) {
    text = await readFile(path, 'utf8').catch(() => null)
    if (text !== null) break
  }
  const signIns = new Map<string, GitlabAuth>()
  if (text === null) return signIns
  const now = Date.now()
  for (const [origin, host] of glabHosts(text.slice(0, 256 * 1024))) {
    const expired = host.oauth && host.expiresAt !== null && host.expiresAt - EXPIRY_MARGIN_MS <= now
    if (host.token && !expired) {
      signIns.set(origin, { token: host.token, oauth: host.oauth })
      continue
    }
    if (!executable) continue
    const key = `${env.GLAB_CONFIG_DIR ?? ''}\n${origin}`
    const cached = signInCache.get(key)
    if (cached && cached.until > now) {
      signIns.set(origin, cached.auth)
      continue
    }
    // Any authenticated request makes glab refresh an expired OAuth token and store the new one.
    if (expired) await glab(executable, ['api', '--hostname', origin, 'user'], env)
    const token = (await glab(executable, ['config', 'get', 'token', '--host', origin], env))?.trim()
    if (!token) continue
    const auth = { token, oauth: host.oauth }
    // Ask glab again once the token may have changed: an OAuth token lasts two hours, a keyring token until sign-out.
    signInCache.set(key, { auth, until: host.oauth ? now + 10 * 60_000 : now + 5 * 60_000 })
    signIns.set(origin, auth)
  }
  return signIns
}

type TokenSource = 'saved' | 'cli' | 'environment'

/**
 * The token for one origin, and where it came from: the one saved in Settings for it, else `glab`'s, else
 * `GITLAB_TOKEN`, which applies to gitlab.com or to `GITLAB_HOST`.
 */
export async function gitlabToken(
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<(GitlabAuth & { source: TokenSource }) | null> {
  const saved = await savedGitlabCredential()
  if (saved?.origin === origin) return { token: saved.token, source: 'saved' }
  const cli = (await gitlabSignIns(env)).get(origin)
  if (cli) return { ...cli, source: 'cli' }
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
  const found = new Map<string, GitlabAuth & { source: TokenSource }>()
  const saved = await savedGitlabCredential()
  if (saved) found.set(saved.origin, { token: saved.token, source: 'saved' })
  for (const [origin, auth] of await gitlabSignIns(env, options.hasCli === false ? null : undefined))
    if (!found.has(origin)) found.set(origin, { ...auth, source: 'cli' })
  const environment = env.GITLAB_TOKEN ?? env.GL_TOKEN
  if (environment) {
    const origin = (env.GITLAB_HOST ?? 'gitlab.com')
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '')
      .toLowerCase()
    if (!found.has(origin)) found.set(origin, { token: environment, source: 'environment' })
  }
  const accounts = await Promise.all(
    [...found].map(async ([origin, { source, ...auth }]) => {
      if (!check) return { origin, source, login: null, state: 'unchecked' as const }
      try {
        const user = await gitlabApi<{ username?: string }>({ origin, ...auth, fetch: options.fetch ?? fetch }, '/user')
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

interface Access extends GitlabAuth {
  cwd: string
  project: GitlabProject
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
  target: GitlabAuth & Pick<Access, 'fetch'> & { origin: string },
  path: string,
  init: { method?: string; body?: unknown; text?: boolean } = {},
): Promise<T> {
  const response = await target
    .fetch(`https://${target.origin}/api/v4${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(target.oauth ? { Authorization: `Bearer ${target.token}` } : { 'PRIVATE-TOKEN': target.token }),
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

/** The names of the project's CI/CD variables; values are never read back. */
export async function gitlabVariableNames(cwd: string, request: typeof fetch = fetch): Promise<string[]> {
  const a = await access(cwd, request)
  const variables = await projectApi<{ key: string }[]>(a, '/variables?per_page=100')
  return (variables ?? []).map((variable) => variable.key)
}

/**
 * Writes CI/CD variables, protected (default branch pipelines only) and masked in job logs when GitLab can mask the
 * value; an existing variable of the same name is updated in place.
 */
export async function setGitlabVariables(
  cwd: string,
  values: Record<string, string>,
  request: typeof fetch = fetch,
): Promise<void> {
  const a = await access(cwd, request)
  const existing = new Set(
    ((await projectApi<{ key: string }[]>(a, '/variables?per_page=100')) ?? []).map((v) => v.key),
  )
  for (const [key, value] of Object.entries(values)) {
    // GitLab masks only single-line values of eight characters or more from its own alphabet.
    const masked = value.length >= 8 && /^[A-Za-z0-9+/=@:.~_-]+$/.test(value)
    const body = { value, protected: true, masked }
    if (existing.has(key)) await projectApi(a, `/variables/${encode(key)}`, { method: 'PUT', body })
    else await projectApi(a, '/variables', { method: 'POST', body: { key, ...body } })
  }
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

interface RawApprovals {
  approved?: boolean
  approved_by?: unknown[]
}

/**
 * Whether someone approved the merge request. GitLab's `approved` only says the approval rules are met, which a
 * project with no rules (gitlab.com's free default) answers true for every merge request nobody has reviewed.
 */
export const approvedBySomeone = (approvals: RawApprovals | null) =>
  approvals?.approved === true && (approvals.approved_by?.length ?? 0) > 0

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
    projectApi<RawApprovals>(a, `/merge_requests/${raw.iid}/approvals`).catch(() => null),
    checksOf(a, raw.iid).catch(() => []),
  ])
  return {
    availability: 'ready',
    service: 'gitlab',
    pullRequest: parseMergeRequest(raw, approvedBySomeone(approvals), checks),
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

/**
 * A job trace as plain log lines. Besides timestamps, gitlab.com's runners start each line with its stream (`00O`,
 * `01E`, `+` for a continued line) and mark collapsible sections with lines of their own; none of it is the log.
 */
export function gitlabJobLog(trace: string): string {
  return failureExcerpt(
    trace
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      .split(/\r?\n/)
      .flatMap((line) => {
        const text = line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z /, '').replace(/^\d{2}[OE]\+? ?/, '')
        const marker = /^section_(?:start|end):\d+:[\w.-]+(?:\[[^\]]*\])?\r?/.exec(text)
        if (!marker) return [text]
        // Older runners put the section's first line after its marker; a marker on its own is dropped.
        const rest = text.slice(marker[0].length)
        return rest ? [rest] : []
      })
      .join('\n'),
  )
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
    const excerpt = log ? gitlabJobLog(log) : ''
    sections.push(
      `### ${check.name}${check.url ? ` (${check.url})` : ''}\n${excerpt ? ['```', excerpt, '```'].join('\n') : 'No log available.'}`,
    )
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

/** The external address GitLab keeps for the project's production environment, which a deploy job sets. */
export async function productionAddress(cwd: string): Promise<string | null> {
  const environments = (await projectApi(await access(cwd), '/environments?name=production&states=available').catch(
    () => [],
  )) as { external_url?: string | null }[]
  const url = environments[0]?.external_url
  return url && /^https?:\/\//.test(url) ? url : null
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
      { origin, token: found.token, oauth: found.oauth, fetch },
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
  const target = { origin, token: found.token, oauth: found.oauth, fetch }
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
  const user = await gitlabApi<{ username?: string }>(
    { origin: project.origin, token: found.token, oauth: found.oauth, fetch },
    '/user',
  )
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
  const target = { origin: project.origin, token: found.token, oauth: found.oauth, fetch }
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
  avatar_url?: string | null
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
    projectApi<RawApprovals>(a, `/merge_requests/${iid}/approvals`).catch(() => null),
    projectApi<RawDiscussion[]>(a, `/merge_requests/${iid}/discussions?per_page=100`).catch(() => null),
  ])
  const pipeline = one.head_pipeline?.status
  return {
    checks: pipeline ? checksRollup([{ state: jobState({ status: pipeline, allow_failure: false }) }]) : null,
    reviewDecision: reviewDecision(one.detailed_merge_status, approvedBySomeone(approvals)),
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
  head_pipeline?: { id?: number; status?: string } | null
  assignees?: RawUser[]
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

/** GitLab's draft prefix, put on a title that has none. */
const draftTitle = (title: string) => (DRAFT_PREFIX.test(title) ? title : `Draft: ${title}`)

/**
 * Merge (now or once the pipeline succeeds), close, reopen, mark ready or draft, or rebase. A merge whose reply is
 * lost is checked before it fails.
 */
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
    case 'auto-merge':
      // `auto_merge` is the current name; servers before GitLab 17 read only `merge_when_pipeline_succeeds`.
      await projectApi(a, `${path}/merge`, {
        method: 'PUT',
        body: {
          squash: action.method === 'squash',
          should_remove_source_branch: action.deleteBranch && !isFork(mr),
          auto_merge: true,
          merge_when_pipeline_succeeds: true,
          ...(mr.sha ? { sha: mr.sha } : {}),
        },
      })
      return
    case 'close':
    case 'reopen':
      await projectApi(a, path, { method: 'PUT', body: { state_event: action.kind } })
      return
    case 'ready':
      if (DRAFT_PREFIX.test(mr.title))
        await projectApi(a, path, { method: 'PUT', body: { title: readyTitle(mr.title) } })
      return
    case 'draft':
      if (!DRAFT_PREFIX.test(mr.title))
        await projectApi(a, path, { method: 'PUT', body: { title: draftTitle(mr.title) } })
      return
    case 'update-branch':
      await projectApi(a, `${path}/rebase`, { method: 'PUT' })
      return
  }
}

export async function pullRequestBody(cwd: string, url: string): Promise<string> {
  return (await readMergeRequest(await access(cwd), url)).description ?? ''
}

interface RawDiff {
  old_path: string
  new_path: string
  new_file: boolean
  deleted_file: boolean
  renamed_file: boolean
  diff?: string
}

/** Lines a GitLab diff adds and removes; its diffs carry only hunks, so every `+` or `-` line is content. */
function diffCounts(diff: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+')) additions++
    else if (line.startsWith('-')) deletions++
  }
  return { additions, deletions }
}

/** The first page of files `url` changes, counted before each patch is cut at Ramu's limit. */
export async function pullRequestFiles(cwd: string, url: string): Promise<{ files: PullRequestFile[]; more: boolean }> {
  const raw = await projectApi<RawDiff[]>(
    await access(cwd),
    `/merge_requests/${iidOf(url)}/diffs?per_page=${FILES_PAGE}`,
  )
  const files = (raw ?? []).map((file): PullRequestFile => {
    // A binary file or one too large for GitLab to diff comes back with an empty diff.
    const diff = file.diff || null
    return {
      path: file.deleted_file ? file.old_path : file.new_path,
      ...(file.renamed_file ? { previousPath: file.old_path } : {}),
      status: file.new_file ? 'added' : file.deleted_file ? 'removed' : file.renamed_file ? 'renamed' : 'modified',
      ...(diff ? diffCounts(diff) : { additions: 0, deletions: 0 }),
      ...boundedPatch(diff),
    }
  })
  return { files, more: files.length >= FILES_PAGE }
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

/** One note as timeline events: a person's note is a comment, a system note the event its wording names. */
function noteEvents(note: RawDiscussionNote, url: string): PullRequestTimelineEvent[] {
  const actor = note.author?.username ?? null
  const at = note.created_at ? Date.parse(note.created_at) || 0 : 0
  if (!note.system) {
    const text = opening(note.body)
    return [{ kind: 'comment', actor, at, ...(text ? { text } : {}), url: `${url}#note_${note.id}` }]
  }
  // The API gives a system note only as its sentence, which GitLab writes in English whatever the account's language.
  const sentence = note.body.trim().split('\n')[0]?.trim() ?? ''
  if (sentence === 'approved this merge request') return [{ kind: 'review', actor, at, verdict: 'approved' }]
  if (sentence.startsWith('requested review from '))
    return [...sentence.matchAll(/@([\w.-]*[\w-])/g)].map((match) => ({
      kind: 'review-requested' as const,
      actor,
      at,
      text: match[1]!,
    }))
  if (/^added \d+ commits?$/.test(sentence)) {
    // The note lists the pushed commits as `<li>sha - headline</li>`; a long push folds some into a summary item.
    const lines = [...note.body.matchAll(/<li>[0-9a-f]{7,40} - (.+?)<\/li>/g)].map((match) => opening(match[1]))
    return (lines.length ? lines : [undefined]).map((text) => ({
      kind: 'commit' as const,
      actor,
      at,
      ...(text ? { text } : {}),
    }))
  }
  if (/^marked (?:this merge request )?as \**ready\**$/i.test(sentence)) return [{ kind: 'ready', actor, at }]
  if (sentence === 'merged') return [{ kind: 'merged', actor, at }]
  if (sentence === 'closed') return [{ kind: 'closed', actor, at }]
  if (sentence === 'reopened') return [{ kind: 'reopened', actor, at }]
  return []
}

/** The latest history of `url`, oldest first, from its notes: comments, approvals, review requests, pushes, states. */
export async function pullRequestTimeline(cwd: string, url: string): Promise<PullRequestTimelineEvent[]> {
  // Newest first, so a long discussion's one page holds its latest notes rather than its earliest.
  const notes = await projectApi<RawDiscussionNote[] | null>(
    await access(cwd),
    `/merge_requests/${iidOf(url)}/notes?sort=desc&order_by=created_at&per_page=100`,
  )
  const link = url.replace(/[?#].*$/, '')
  return (notes ?? [])
    .reverse()
    .flatMap((note) => noteEvents(note, link))
    .slice(-TIMELINE_LENGTH)
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
            ...(note.author?.avatar_url ? { avatarUrl: note.author.avatar_url } : {}),
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

/** GitLab user ids for names, taking ones the merge request already lists before asking the server. */
async function userIds(a: Access, names: string[], known: RawUser[]): Promise<number[]> {
  const target = { ...a, origin: a.project.origin }
  return Promise.all(
    names.map(async (name) => {
      const existing = known.find((user) => user.username.toLowerCase() === name.toLowerCase())
      if (existing) return existing.id
      const [user] = await gitlabApi<{ id: number }[]>(target, `/users?username=${encode(name)}`)
      if (!user) throw new Error(`GitLab has no user named ${name}.`)
      return user.id
    }),
  )
}

const without = (users: RawUser[] | undefined, names: string[]) => {
  const gone = new Set(names.map((name) => name.toLowerCase()))
  return (users ?? []).filter((user) => !gone.has(user.username.toLowerCase())).map((user) => user.id)
}

/** Adds the named users as reviewers, keeping the ones already there. */
export async function requestReviews(cwd: string, url: string, reviewers: string[]): Promise<void> {
  if (!reviewers.length) return
  const a = await access(cwd)
  const mr = await readMergeRequest(a, url)
  const found = await userIds(a, reviewers, mr.reviewers ?? [])
  const ids = [...new Set([...(mr.reviewers ?? []).map((reviewer) => reviewer.id), ...found])]
  await projectApi(a, `/merge_requests/${mr.iid}`, { method: 'PUT', body: { reviewer_ids: ids } })
}

/** Removes the named reviewers; a name that is not a reviewer is already off the list. */
export async function removeReviewers(cwd: string, url: string, reviewers: string[]): Promise<void> {
  const a = await access(cwd)
  const mr = await readMergeRequest(a, url)
  await projectApi(a, `/merge_requests/${mr.iid}`, {
    method: 'PUT',
    body: { reviewer_ids: without(mr.reviewers, reviewers) },
  })
}

/** Where one diff line sits: its numbers on each side, and the counters GitLab builds its line code from. */
interface DiffLine {
  added: boolean
  oldLine: number | null
  newLine: number | null
  oldPosition: number
  newPosition: number
}

/**
 * Finds a line of the new (or old) version in a GitLab diff's hunks. An unchanged line has both numbers, and an added
 * or removed line carries the other side's counter at that point, as GitLab's own line codes do.
 */
export function diffLine(diff: string, line: number, side: PullRequestSide): DiffLine | null {
  let oldLine = 0
  let newLine = 0
  let inHunk = false
  for (const text of diff.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      inHunk = true
      continue
    }
    if (!inHunk || !text || text.startsWith('\\')) continue
    const at = { oldPosition: oldLine, newPosition: newLine }
    if (text.startsWith('+')) {
      if (side === 'new' && newLine === line) return { added: true, oldLine: null, newLine, ...at }
      newLine++
    } else if (text.startsWith('-')) {
      if (side === 'old' && oldLine === line) return { added: false, oldLine, newLine: null, ...at }
      oldLine++
    } else {
      if ((side === 'new' ? newLine : oldLine) === line) return { added: false, oldLine, newLine, ...at }
      oldLine++
      newLine++
    }
  }
  return null
}

type LineDraft = Omit<ReviewCommentDraft, 'id'>

const lineNumbers = (line: Pick<DiffLine, 'oldLine' | 'newLine'>) => ({
  ...(line.oldLine !== null ? { old_line: line.oldLine } : {}),
  ...(line.newLine !== null ? { new_line: line.newLine } : {}),
})

/**
 * A diff note's position. GitLab needs both numbers on an unchanged line and a line code for each end of a range, so
 * both come from the file's diff; a file or line the first page of diffs does not show is placed by its number alone.
 */
export function notePosition(
  refs: NonNullable<RawOneMergeRequest['diff_refs']>,
  comment: LineDraft,
  diffs: RawDiff[],
): Record<string, unknown> {
  const side = comment.side ?? 'new'
  const file = diffs.find((entry) => entry.new_path === comment.path || entry.old_path === comment.path)
  const find = (line: number) => (file?.diff ? diffLine(file.diff, line, side) : null)
  const end = find(comment.line)
  const start =
    end && comment.startLine !== undefined && comment.startLine < comment.line ? find(comment.startLine) : null
  const hash = file ? createHash('sha1').update(file.new_path).digest('hex') : ''
  const point = (line: DiffLine) => ({
    line_code: `${hash}_${line.oldPosition}_${line.newPosition}`,
    type: line.added ? 'new' : 'old',
    ...lineNumbers(line),
  })
  return {
    position_type: 'text',
    base_sha: refs.base_sha,
    start_sha: refs.start_sha,
    head_sha: refs.head_sha,
    old_path: file?.old_path ?? comment.path,
    new_path: file?.new_path ?? comment.path,
    ...(end ? lineNumbers(end) : side === 'old' ? { old_line: comment.line } : { new_line: comment.line }),
    ...(end && start ? { line_range: { start: point(start), end: point(end) } } : {}),
  }
}

/** The comment's text with its suggested change, which GitLab applies to the lines above the comment's line too. */
export function noteBody(comment: Pick<LineDraft, 'body' | 'line' | 'startLine' | 'suggestion'>): string {
  if (comment.suggestion === undefined) return comment.body
  const above =
    comment.startLine !== undefined && comment.startLine < comment.line ? comment.line - comment.startLine : 0
  return `${comment.body}\n\n\`\`\`suggestion:-${above}+0\n${comment.suggestion}\n\`\`\``
}

/** Posts line comments as diff discussions and returns each one's note id. */
async function postLineComments(a: Access, mr: RawOneMergeRequest, comments: LineDraft[]): Promise<string[]> {
  if (!comments.length) return []
  const refs = mr.diff_refs
  if (!refs) throw new Error('GitLab has not prepared this merge request’s diff yet.')
  const diffs = await projectApi<RawDiff[]>(a, `/merge_requests/${mr.iid}/diffs?per_page=${FILES_PAGE}`).catch(() => [])
  const ids: string[] = []
  for (const comment of comments) {
    const discussion = await projectApi<RawDiscussion>(a, `/merge_requests/${mr.iid}/discussions`, {
      method: 'POST',
      body: { body: noteBody(comment), position: notePosition(refs, comment, diffs ?? []) },
    })
    ids.push(String(discussion.notes[0]?.id ?? discussion.id))
  }
  return ids
}

/**
 * Inline comments as diff discussions, the summary as a note, then the approval. GitLab's API has no "request
 * changes" verdict, so that review posts its comments and summary without approving.
 */
export async function submitReview(
  cwd: string,
  url: string,
  review: { verdict: ReviewVerdict; body: string; comments: ReviewCommentDraft[] },
): Promise<void> {
  const a = await access(cwd)
  const mr = await readMergeRequest(a, url)
  const path = `/merge_requests/${mr.iid}`
  await postLineComments(a, mr, review.comments)
  if (review.body.trim()) await projectApi(a, `${path}/notes`, { method: 'POST', body: { body: review.body } })
  if (review.verdict === 'approve')
    await projectApi(a, `${path}/approve`, { method: 'POST', body: mr.sha ? { sha: mr.sha } : {} })
}

export async function comment(cwd: string, url: string, body: string): Promise<string> {
  const note = await projectApi<{ id: number }>(await access(cwd), `/merge_requests/${iidOf(url)}/notes`, {
    method: 'POST',
    body: { body },
  })
  return String(note.id)
}

export async function lineComment(cwd: string, url: string, draft: LineDraft): Promise<string> {
  const a = await access(cwd)
  const [id] = await postLineComments(a, await readMergeRequest(a, url), [draft])
  return id!
}

const notePath = (url: string, commentId: string) => {
  if (!/^\d+$/.test(commentId)) throw new Error('That is not a GitLab comment id.')
  return `/merge_requests/${iidOf(url)}/notes/${commentId}`
}

export async function editComment(cwd: string, url: string, commentId: string, body: string): Promise<void> {
  await projectApi(await access(cwd), notePath(url, commentId), { method: 'PUT', body: { body } })
}

export async function deleteComment(cwd: string, url: string, commentId: string): Promise<void> {
  await projectApi(await access(cwd), notePath(url, commentId), { method: 'DELETE' })
}

export async function setThreadStatus(
  cwd: string,
  url: string,
  threadId: string,
  status: PullRequestThreadStatus,
): Promise<void> {
  if (status !== 'active' && status !== 'resolved')
    throw new Error(unsupportedPullRequestText('gitlab', 'thread-status'))
  await projectApi(await access(cwd), `/merge_requests/${iidOf(url)}/discussions/${encode(threadId)}`, {
    method: 'PUT',
    body: { resolved: status === 'resolved' },
  })
}

/** GitLab's award emoji names for each reaction. */
const AWARD: Record<PullRequestReaction, string> = {
  'thumbs-up': 'thumbsup',
  'thumbs-down': 'thumbsdown',
  laugh: 'laughing',
  hooray: 'tada',
  confused: 'confused',
  heart: 'heart',
  rocket: 'rocket',
  eyes: 'eyes',
}

/** Adds an award emoji to a note, or takes back the account's own; one already gone stays gone. */
export async function react(
  cwd: string,
  url: string,
  commentId: string,
  reaction: PullRequestReaction,
  remove: boolean,
): Promise<void> {
  const a = await access(cwd)
  const path = `${notePath(url, commentId)}/award_emoji`
  const name = AWARD[reaction]
  if (!remove) {
    await projectApi(a, path, { method: 'POST', body: { name } })
    return
  }
  const [viewer, awards] = await Promise.all([
    viewerOf(a),
    projectApi<{ id: number; name: string; user?: { id?: number } }[]>(a, `${path}?per_page=100`),
  ])
  if (viewer?.id === undefined)
    throw new Error('GitLab did not say whose token this is, so Ramu cannot find its award.')
  const own = (awards ?? []).find((award) => award.name === name && award.user?.id === viewer.id)
  if (own) await projectApi(a, `${path}/${own.id}`, { method: 'DELETE' })
}

/** Takes back the account's approval. GitLab's API has no change request to take back. */
export async function withdrawReview(cwd: string, url: string): Promise<void> {
  const a = await access(cwd)
  await projectApi(a, `/merge_requests/${iidOf(url)}/unapprove`, { method: 'POST' }).catch((error: unknown) => {
    // GitLab answers 404 when this account has no approval on the merge request.
    if (error instanceof ForgeError && /could not find/.test(error.message))
      throw new Error('This account has not approved this merge request, so there is nothing to take back.')
    throw error
  })
}

/** Changes the fields asked for in one request; a draft keeps its prefix when only its title changes. */
export async function updatePullRequest(cwd: string, url: string, update: PullRequestUpdate): Promise<void> {
  const a = await access(cwd)
  const mr = await readMergeRequest(a, url)
  const body: Record<string, unknown> = {}
  if (update.title !== undefined) body.title = DRAFT_PREFIX.test(mr.title) ? draftTitle(update.title) : update.title
  if (update.body !== undefined) body.description = update.body
  if (update.base !== undefined) body.target_branch = update.base
  if (update.labels?.add.length) body.add_labels = update.labels.add.join(',')
  if (update.labels?.remove.length) body.remove_labels = update.labels.remove.join(',')
  if (update.assignees) {
    const added = await userIds(a, update.assignees.add, mr.assignees ?? [])
    body.assignee_ids = [...new Set([...without(mr.assignees, update.assignees.remove), ...added])]
  }
  if (Object.keys(body).length) await projectApi(a, `/merge_requests/${mr.iid}`, { method: 'PUT', body })
}

/** Retries the failed jobs of the head pipeline; nothing runs when it has not failed. */
export async function rerunChecks(cwd: string, url: string): Promise<number> {
  const a = await access(cwd)
  const pipeline = (await readMergeRequest(a, url)).head_pipeline
  if (pipeline?.id === undefined || pipeline.status !== 'failed') return 0
  await projectApi(a, `/pipelines/${pipeline.id}/retry`, { method: 'POST' })
  return 1
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
  productionAddress,
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
  // Every note on no file is a discussion that `reviewThreads` already returns.
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
