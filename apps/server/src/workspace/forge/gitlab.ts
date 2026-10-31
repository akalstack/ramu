// GitLab merge requests, pipelines and issues through the REST API (v4), with the user's own `glab` sign-in or a
// `GITLAB_TOKEN`. Like github.ts, Git runs with argument arrays only; the token is sent only to the project's origin.
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
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
import { glabHosts, parseGitlabRemote, type GitlabProject } from '@ramu/shared/forgeHosts'
import { redactSecrets } from '@ramu/shared/forgeRemote'
import { currentBranch, git, publishRemote } from '../git'
import { registerForgeAdapter } from './adapter'
import { ForgeError, failureExcerpt, pullRequestDraft } from './github'

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

/** The token for one origin, and where it came from. `GITLAB_TOKEN` applies to gitlab.com or to `GITLAB_HOST`. */
export async function gitlabToken(
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ token: string; source: 'cli' | 'environment' } | null> {
  const cli = (await gitlabSignIns(env)).get(origin)
  if (cli) return { token: cli, source: 'cli' }
  const named = (env.GITLAB_HOST ?? 'gitlab.com')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .toLowerCase()
  const token = env.GITLAB_TOKEN ?? env.GL_TOKEN
  return token && named === origin ? { token, source: 'environment' } : null
}

/** Self-managed GitLab servers the person has signed in to, so their remotes are recognised as GitLab. */
export async function knownGitlabHosts(): Promise<Set<string>> {
  const hosts = new Set((await gitlabSignIns()).keys())
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
  source: 'cli' | 'environment'
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
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await target
    .fetch(`https://${target.origin}/api/v4${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'PRIVATE-TOKEN': target.token,
        Accept: 'application/json',
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
  return (text ? JSON.parse(text) : null) as T
}

const projectApi = (a: Access, path = '') =>
  gitlabApi({ ...a, origin: a.project.origin }, `/projects/${encode(a.project.path)}${path}`)

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

interface RawNote {
  body: string
  resolvable?: boolean
  resolved?: boolean
  system?: boolean
  author?: { username?: string }
  position?: { new_path?: string; new_line?: number | null }
}

/** Unresolved review threads as a prompt, or null when there are none. */
export function discussionsPrompt(mr: PullRequestInfo, discussions: { notes: RawNote[] }[]): string | null {
  const open = discussions
    .map((discussion) => discussion.notes.filter((note) => !note.system))
    .filter((notes) => notes.length && notes[0]!.resolvable && !notes[0]!.resolved)
  if (!open.length) return null
  const threads = open.map((notes) => {
    const first = notes[0]!
    const where = first.position?.new_path
      ? `${first.position.new_path}${first.position.new_line ? `:${first.position.new_line}` : ''}: `
      : ''
    return `- ${where}${notes.map((note) => `${note.author?.username ?? 'reviewer'}: ${note.body.trim()}`).join('\n  ')}`
  })
  return [`Address the unresolved review comments on merge request !${mr.number} (${mr.title}):`, '', ...threads].join(
    '\n',
  )
}

export async function pullRequestFeedback(cwd: string, kind: PullRequestFeedbackKind, url?: string): Promise<string> {
  const a = await access(cwd)
  const raw = await mergeRequest(a, url)
  if (!raw) throw new Error('This branch has no merge request.')
  const mr = parseMergeRequest(raw, false, kind === 'checks' ? await checksOf(a, raw.iid) : [])
  if (kind === 'reviews') {
    const discussions = (await projectApi(a, `/merge_requests/${raw.iid}/discussions?per_page=100`)) as {
      notes: RawNote[]
    }[]
    const prompt = discussionsPrompt(mr, discussions)
    if (!prompt) throw new Error('No unresolved review comments.')
    return redactSecrets(prompt)
  }
  const failed = mr.checks.filter((check) => check.state === 'failure')
  if (!failed.length) throw new Error('No failing pipeline jobs.')
  const sections: string[] = []
  for (const check of failed.slice(0, 5)) {
    const id = check.url ? /\/-\/jobs\/(\d+)/.exec(check.url)?.[1] : undefined
    const log = id
      ? await gitlabApi<string>(
          { ...a, origin: a.project.origin },
          `/projects/${encode(a.project.path)}/jobs/${id}/trace`,
        )
          .then((text) => (typeof text === 'string' ? text : ''))
          .catch(() => '')
      : ''
    sections.push(`### ${check.name}\n${log ? failureExcerpt(log) : 'No log available.'}`)
  }
  return redactSecrets(
    [`Fix the failing pipeline jobs on merge request !${mr.number} (${mr.title}):`, '', ...sections].join('\n'),
  )
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
  return { origin: project.origin, login: user, source: 'cli', ambiguous: false }
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
      api: { read: unknown('Sign in with glab or set GITLAB_TOKEN.'), write: unknown() },
      transport,
      checkedAt,
    }
  const target = { origin: project.origin, token: found.token, fetch }
  const login = await gitlabApi<{ username?: string }>(target, '/user')
    .then((user) => user.username ?? null)
    .catch(() => null)
  const account = { source: 'cli' as const, login, connectionId: null, ambiguous: false }
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

/** GitLab behind the shared adapter boundary, chosen for checkouts whose remote is a GitLab server. */
registerForgeAdapter({
  id: 'gitlab',
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
