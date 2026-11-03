// Azure DevOps Services (Azure Repos) pull requests, builds and work items through its REST API. Its CLI is an
// extension of `az`, so the credential is a personal access token saved in Settings or given in the environment
// (see azureCredentials.ts). Git runs with argument arrays only, and the token is sent only to dev.azure.com:
// legacy `*.visualstudio.com` organizations answer there too.
import type {
  AzureSummary,
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
import { redactSecrets } from '@ramu/shared/forgeRemote'
import { currentBranch, git, publishRemote } from '../git'
import { registerForgeAdapter } from './adapter'
import { ForgeError, pullRequestDraft } from './github'
import { azureCredential, type AzureCredential } from './azureCredentials'
import { FAILED_STEPS, failedStepLog } from './buildLogs'

const API = 'https://dev.azure.com'
const VERSION = 'api-version=7.1'
/** Build validation is a branch policy; its type id is the same in every organization. */
const BUILD_POLICY = '0609b952-1397-4640-95ec-e00a01b2c241'

export interface AzureRepository {
  organization: string
  project: string
  repo: string
}

const NAME = /^[^/\\]+$/

/**
 * Organization, project and repository from an Azure Repos remote: `dev.azure.com/org/project/_git/repo` (with or
 * without a user name), `org.visualstudio.com[/DefaultCollection]/project/_git/repo`, and the SSH forms
 * `git@ssh.dev.azure.com:v3/org/project/repo` and `org@vs-ssh.visualstudio.com:v3/org/project/repo`. A repository
 * named like its project may leave the project out.
 */
export function parseAzureRemote(url: string): AzureRepository | null {
  const text = url.trim()
  const ssh =
    /^(?:ssh:\/\/)?[A-Za-z0-9._-]+@(?:ssh\.dev\.azure\.com|vs-ssh\.visualstudio\.com)[:/]v3\/([^/]+)\/([^/]+)\/([^/]+?)\/?$/i.exec(
      text,
    )
  const parts = (values: (string | undefined)[]): AzureRepository | null => {
    let decoded: string[]
    try {
      decoded = values.map((value) => decodeURIComponent(value ?? '').replace(/\.git$/i, ''))
    } catch {
      return null
    }
    const [organization, project, repo] = decoded
    return organization && project && repo && decoded.every((part) => NAME.test(part) && part !== '..')
      ? { organization, project, repo }
      : null
  }
  if (ssh) return parts([ssh[1], ssh[2], ssh[3]])
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.password) return null
  const path = parsed.pathname.split('/').filter(Boolean)
  const host = parsed.hostname.toLowerCase()
  const legacy = /^([a-z0-9][a-z0-9-]*)\.visualstudio\.com$/.exec(host)
  const segments = host === 'dev.azure.com' ? path : legacy ? [legacy[1]!, ...path] : null
  if (!segments) return null
  if (legacy && segments[1]?.toLowerCase() === 'defaultcollection') segments.splice(1, 1)
  const git = segments.indexOf('_git')
  if (git === 2 && segments.length === 4) return parts([segments[0], segments[1], segments[3]])
  if (git === 1 && segments.length === 3) return parts([segments[0], segments[2], segments[2]])
  return null
}

export async function azureRepositoryOf(cwd: string): Promise<AzureRepository | null> {
  try {
    const { remote } = await publishRemote(cwd, await currentBranch(cwd))
    return remote ? parseAzureRemote((await git(cwd, ['remote', 'get-url', remote])).trim()) : null
  } catch {
    return null
  }
}

type Target = AzureCredential & { fetch?: typeof fetch }

/** One API request below `https://dev.azure.com/`. Bounded in time and size; errors never echo the token or body. */
export async function azureApi<T>(
  target: Target,
  path: string,
  init: { method?: string; body?: unknown; text?: boolean } = {},
): Promise<T> {
  const response = await (target.fetch ?? fetch)(`${API}${path}${path.includes('?') ? '&' : '?'}${VERSION}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`:${target.token}`).toString('base64')}`,
      Accept: init.text ? 'text/plain' : 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  }).catch(() => {
    throw new ForgeError('Could not reach Azure DevOps. Check the network and try again.', null)
  })
  // A refused token gets a sign-in page with 203 rather than a 401.
  if (response.status === 401 || response.status === 203)
    throw new ForgeError(
      'Azure DevOps did not accept this token. Connect again in Settings → Git with a current personal access token.',
      'signed-out',
    )
  if (response.status === 403)
    throw new ForgeError('This Azure DevOps token does not have permission for that. Check its scopes.', null)
  if (response.status === 404)
    throw new ForgeError('Azure DevOps could not find that, or this account cannot see it.', null)
  if (!response.ok) throw new ForgeError(`Azure DevOps answered ${response.status}. Try again in a moment.`, null)
  const text = await response.text()
  if (text.length > 8 * 1024 * 1024) throw new ForgeError('Azure DevOps sent more than Ramu reads at once.', null)
  return (init.text ? text : text ? JSON.parse(text) : null) as T
}

interface Access {
  cwd: string
  repo: AzureRepository
  credential: Target
}

const signInHint = 'Connect Azure DevOps in Settings → Git, or set AZURE_DEVOPS_EXT_PAT on the host.'

async function access(cwd: string): Promise<Access> {
  const repo = await azureRepositoryOf(cwd)
  if (!repo) throw new ForgeError('This repository has no Azure DevOps remote.', 'no-remote')
  const credential = await azureCredential()
  if (!credential) throw new ForgeError(signInHint, 'signed-out')
  return { cwd, repo, credential }
}

const q = (value: string) => encodeURIComponent(value)
const projectPath = (repo: AzureRepository) => `/${q(repo.organization)}/${q(repo.project)}`
const projectApi = <T>(a: Access, path: string, init?: { method?: string; body?: unknown; text?: boolean }) =>
  azureApi<T>(a.credential, `${projectPath(a.repo)}/_apis${path}`, init)
const repoApi = <T>(a: Access, path = '', init?: { method?: string; body?: unknown }) =>
  projectApi<T>(a, `/git/repositories/${q(a.repo.repo)}${path}`, init)
/** The address a person opens, which the API does not return for pull requests. */
const webBase = (repo: AzureRepository) => `${API}${projectPath(repo)}/_git/${q(repo.repo)}`

const branchOf = (ref: string) => ref.replace(/^refs\/heads\//, '')

interface RawPullRequest {
  pullRequestId: number
  title: string
  status: 'active' | 'completed' | 'abandoned' | 'notSet'
  isDraft?: boolean
  sourceRefName: string
  targetRefName: string
  lastMergeSourceCommit?: { commitId?: string }
  reviewers?: { vote: number; isRequired?: boolean }[]
  repository?: { project?: { id?: string } }
}

interface RawStatus {
  id: number
  state: 'succeeded' | 'failed' | 'error' | 'pending' | 'notApplicable' | 'notSet'
  context: { name: string; genre?: string }
  targetUrl?: string
}

interface RawEvaluation {
  status: 'queued' | 'running' | 'approved' | 'rejected' | 'notApplicable' | 'broken'
  configuration: { type: { id: string; displayName?: string }; settings?: { displayName?: string } }
  context?: { buildId?: number; buildDefinitionName?: string }
}

export function statusState(state: RawStatus['state']): ForgeCheckState {
  if (state === 'succeeded') return 'success'
  if (state === 'failed' || state === 'error') return 'failure'
  if (state === 'notApplicable') return 'skipped'
  return 'pending'
}

/** Pull request statuses and build validation policies as checks: the latest status per context, every build policy. */
export function parseChecks(statuses: RawStatus[], evaluations: RawEvaluation[], repo: AzureRepository): ForgeCheck[] {
  const latest = new Map<string, RawStatus>()
  for (const status of statuses) {
    const key = `${status.context.genre ?? ''}/${status.context.name}`
    if ((latest.get(key)?.id ?? -1) < status.id) latest.set(key, status)
  }
  const fromStatuses = [...latest.values()].map((status) => ({
    name: status.context.genre ? `${status.context.genre}/${status.context.name}` : status.context.name,
    state: statusState(status.state),
    url: status.targetUrl ?? null,
  }))
  const builds = evaluations
    .filter((evaluation) => evaluation.configuration.type.id === BUILD_POLICY && evaluation.status !== 'notApplicable')
    .map((evaluation) => ({
      name:
        evaluation.configuration.settings?.displayName ||
        evaluation.context?.buildDefinitionName ||
        evaluation.configuration.type.displayName ||
        'Build',
      state: (evaluation.status === 'approved'
        ? 'success'
        : evaluation.status === 'rejected' || evaluation.status === 'broken'
          ? 'failure'
          : 'pending') as ForgeCheckState,
      url: evaluation.context?.buildId
        ? `${API}${projectPath(repo)}/_build/results?buildId=${evaluation.context.buildId}`
        : null,
    }))
  return [...fromStatuses, ...builds].sort((a, b) => a.name.localeCompare(b.name))
}

/** Votes: 10 approved, 5 approved with suggestions, -5 waiting for the author, -10 rejected. */
export function reviewDecision(reviewers: RawPullRequest['reviewers']): PullRequestReviewDecision {
  const all = reviewers ?? []
  if (all.some((reviewer) => reviewer.vote < 0)) return 'changes-requested'
  if (all.some((reviewer) => reviewer.isRequired && reviewer.vote <= 0)) return 'review-required'
  if (all.some((reviewer) => reviewer.vote > 0)) return 'approved'
  return all.length ? 'review-required' : null
}

export function parsePullRequest(raw: RawPullRequest, checks: ForgeCheck[], repo: AzureRepository): PullRequestInfo {
  return {
    number: raw.pullRequestId,
    title: raw.title,
    url: `${webBase(repo)}/pullrequest/${raw.pullRequestId}`,
    state: raw.status === 'completed' ? 'merged' : raw.status === 'active' ? 'open' : 'closed',
    draft: Boolean(raw.isDraft),
    baseBranch: branchOf(raw.targetRefName),
    headBranch: branchOf(raw.sourceRefName),
    ...(raw.lastMergeSourceCommit?.commitId ? { headCommit: raw.lastMergeSourceCommit.commitId } : {}),
    reviewDecision: reviewDecision(raw.reviewers),
    checks,
  }
}

/** The pull request `url` names, or the newest one for the checked-out branch. */
async function findPullRequest(a: Access, url?: string): Promise<RawPullRequest | null> {
  const id = url ? /\/pullrequest\/(\d+)/i.exec(url)?.[1] : undefined
  if (id) return repoApi<RawPullRequest>(a, `/pullrequests/${id}`)
  const branch = await currentBranch(a.cwd)
  if (!branch) return null
  const page = await repoApi<{ value: RawPullRequest[] }>(
    a,
    `/pullrequests?searchCriteria.sourceRefName=${q(`refs/heads/${branch}`)}&searchCriteria.status=all&$top=1`,
  )
  return page.value[0] ?? null
}

async function checksOf(a: Access, raw: RawPullRequest): Promise<{ checks: ForgeCheck[]; builds: number[] }> {
  const statuses = await repoApi<{ value: RawStatus[] }>(a, `/pullrequests/${raw.pullRequestId}/statuses`)
    .then((page) => page.value)
    .catch(() => [])
  const projectId = raw.repository?.project?.id
  const evaluations = projectId
    ? await projectApi<{ value: RawEvaluation[] }>(
        a,
        `/policy/evaluations?artifactId=${q(`vstfs:///CodeReview/CodeReviewId/${projectId}/${raw.pullRequestId}`)}`,
      )
        .then((page) => page.value)
        .catch(() => [])
    : []
  const builds = evaluations
    .filter(
      (evaluation) =>
        evaluation.configuration.type.id === BUILD_POLICY &&
        (evaluation.status === 'rejected' || evaluation.status === 'broken') &&
        evaluation.context?.buildId,
    )
    .map((evaluation) => evaluation.context!.buildId!)
  return { checks: parseChecks(statuses, evaluations, a.repo), builds }
}

export async function pullRequestStatus(cwd: string, url?: string): Promise<ForgeStatus> {
  let a: Access
  try {
    a = await access(cwd)
  } catch (error) {
    if (error instanceof ForgeError && error.availability)
      return { availability: error.availability, service: 'azure', pullRequest: null }
    throw error
  }
  const raw = await findPullRequest(a, url)
  if (!raw) return { availability: 'ready', service: 'azure', pullRequest: null }
  const { checks } = await checksOf(a, raw).catch(() => ({ checks: [] }))
  return { availability: 'ready', service: 'azure', pullRequest: parsePullRequest(raw, checks, a.repo) }
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
        sourceRefName: `refs/heads/${branch}`,
        targetRefName: `refs/heads/${input.base}`,
        ...(input.draft ? { isDraft: true } : {}),
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

interface RawThread {
  status?: 'active' | 'pending' | 'fixed' | 'wontFix' | 'closed' | 'byDesign' | 'unknown'
  isDeleted?: boolean
  threadContext?: { filePath?: string; rightFileStart?: { line?: number } } | null
  comments?: { content?: string; commentType?: string; isDeleted?: boolean; author?: { displayName?: string } }[]
}

/** Active review threads as a prompt, or null when there are none. System notes (votes, pushes) are left out. */
export function commentsPrompt(pr: PullRequestInfo, threads: RawThread[]): string | null {
  const lines = threads
    .filter((thread) => !thread.isDeleted && (thread.status === 'active' || thread.status === 'pending'))
    .map((thread) => {
      const comment = thread.comments?.find((entry) => !entry.isDeleted && entry.commentType !== 'system')
      const text = comment?.content?.trim()
      if (!text) return null
      const path = thread.threadContext?.filePath?.replace(/^\//, '')
      const line = thread.threadContext?.rightFileStart?.line
      const where = path ? `${path}${line ? `:${line}` : ''}: ` : ''
      return `- ${where}${comment?.author?.displayName ?? 'reviewer'}: ${text}`
    })
    .filter((line): line is string => !!line)
  if (!lines.length) return null
  return [`Address the open review comments on pull request #${pr.number} (${pr.title}):`, '', ...lines].join('\n')
}

interface RawTimeline {
  records?: { type?: string; name?: string; result?: string | null; log?: { id?: number } | null }[]
}

async function failedBuildLogs(a: Access, buildId: number): Promise<string[]> {
  const timeline = await projectApi<RawTimeline>(a, `/build/builds/${buildId}/timeline`)
  const failed = (timeline.records ?? []).filter(
    (record) => record.type === 'Task' && record.result === 'failed' && record.log?.id,
  )
  const logs: string[] = []
  for (const record of failed.slice(0, FAILED_STEPS)) {
    const text = await projectApi<string>(a, `/build/builds/${buildId}/logs/${record.log!.id}`, { text: true }).catch(
      () => '',
    )
    const block = failedStepLog(`${record.name ?? 'Step'} (build ${buildId})`, text)
    if (block) logs.push(block)
  }
  return logs
}

export async function pullRequestFeedback(cwd: string, kind: PullRequestFeedbackKind, url?: string): Promise<string> {
  const a = await access(cwd)
  const raw = await findPullRequest(a, url)
  if (!raw) throw new Error('This branch has no pull request.')
  if (kind === 'reviews') {
    const pr = parsePullRequest(raw, [], a.repo)
    const threads = await repoApi<{ value: RawThread[] }>(a, `/pullrequests/${raw.pullRequestId}/threads`)
    const prompt = commentsPrompt(pr, threads.value)
    if (!prompt) throw new Error('No open review comments.')
    return redactSecrets(prompt)
  }
  const { checks, builds } = await checksOf(a, raw)
  const pr = parsePullRequest(raw, checks, a.repo)
  const failed = pr.checks.filter((check) => check.state === 'failure')
  if (!failed.length) throw new Error('No failing builds.')
  const logs = (
    await Promise.all(builds.slice(0, FAILED_STEPS).map((id) => failedBuildLogs(a, id).catch(() => [])))
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

interface RawWorkItem {
  id: number
  fields: Record<string, unknown>
}

const field = (item: RawWorkItem, name: string) => {
  const value = item.fields[name]
  return typeof value === 'string' ? value : ''
}
const workItemUrl = (repo: AzureRepository, id: number) => `${API}${projectPath(repo)}/_workitems/edit/${id}`
/** Work item descriptions are HTML; a thread reads them as text. */
export const htmlText = (html: string) =>
  html
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/** Work items still open in the repository's project, newest change first; Azure Boards plays the issue tracker. */
export async function listIssues(cwd: string, search: string): Promise<IssueSummary[]> {
  const a = await access(cwd)
  const text = search.trim().slice(0, 200).replaceAll("'", "''")
  const query =
    "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] NOT IN ('Closed', 'Done', 'Removed', 'Resolved', 'Completed')" +
    (text ? ` AND [System.Title] CONTAINS '${text}'` : '') +
    ' ORDER BY [System.ChangedDate] DESC'
  const found = await projectApi<{ workItems?: { id: number }[] }>(a, '/wit/wiql?$top=30', {
    method: 'POST',
    body: { query },
  })
  const ids = (found.workItems ?? []).slice(0, 30).map((item) => item.id)
  if (!ids.length) return []
  const fields = ['System.Title', 'System.WorkItemType', 'System.ChangedDate', 'System.Tags'].join(',')
  const items = await projectApi<{ value: RawWorkItem[] }>(a, `/wit/workitems?ids=${ids.join(',')}&fields=${fields}`)
  return items.value
    .map((item) => ({
      number: item.id,
      title: field(item, 'System.Title'),
      url: workItemUrl(a.repo, item.id),
      labels: [
        field(item, 'System.WorkItemType'),
        ...field(item, 'System.Tags')
          .split(';')
          .map((tag) => tag.trim()),
      ].filter(Boolean),
      updatedAt: Date.parse(field(item, 'System.ChangedDate')) || 0,
    }))
    .sort((x, y) => y.updatedAt - x.updatedAt)
}

export async function issueDetails(cwd: string, number: number) {
  const a = await access(cwd)
  const item = await projectApi<RawWorkItem>(a, `/wit/workitems/${number}`)
  const title = field(item, 'System.Title')
  const body = htmlText(
    [field(item, 'System.Description'), field(item, 'Microsoft.VSTS.Common.AcceptanceCriteria')]
      .filter(Boolean)
      .join('\n\n'),
  ).slice(0, 20_000)
  const url = workItemUrl(a.repo, item.id)
  return {
    title,
    url,
    prompt: redactSecrets(`Work on Azure DevOps work item #${item.id}: ${title}\n${url}${body ? `\n\n${body}` : ''}`),
  }
}

interface RawRepository {
  name: string
  remoteUrl?: string
  isDisabled?: boolean
  project: { name: string; visibility?: string; lastUpdateTime?: string }
}

export function parseRepositories(raw: RawRepository[]): ForgeRepositorySummary[] {
  return raw.flatMap((repo) => {
    if (repo.isDisabled || !repo.remoteUrl?.startsWith('https://')) return []
    // Azure puts the organization in the clone address as a user name; Ramu never stores credentials in a remote.
    const url = new URL(repo.remoteUrl)
    url.username = ''
    url.password = ''
    return [
      {
        fullName: `${repo.project.name}/${repo.name}`,
        description: null,
        private: repo.project.visibility !== 'public',
        cloneUrl: url.toString(),
        updatedAt: repo.project.lastUpdateTime ? Date.parse(repo.project.lastUpdateTime) : 0,
      },
    ]
  })
}

const noOrganization = 'Name your Azure DevOps organization in Settings → Git to browse and create repositories.'

export async function searchRepositories(search: string, cwd?: string): Promise<ForgeRepositorySummary[]> {
  const credential = await azureCredential()
  if (!credential) throw new ForgeError(signInHint, 'signed-out')
  const organization = (cwd ? (await azureRepositoryOf(cwd))?.organization : undefined) ?? credential.organization
  if (!organization) throw new Error(noOrganization)
  const text = search.trim().toLowerCase()
  const page = await azureApi<{ value: RawRepository[] }>(credential, `/${q(organization)}/_apis/git/repositories`)
  return parseRepositories(page.value)
    .filter((repo) => !text || repo.fullName.toLowerCase().includes(text))
    .sort((x, y) => y.updatedAt - x.updatedAt)
    .slice(0, 30)
}

/** Creates `project/name` in the saved organization; the project's own visibility applies. */
export async function publishRepository(cwd: string, input: PublishRepositoryInput): Promise<void> {
  const remotes = (await git(cwd, ['remote'])).trim().split('\n').filter(Boolean)
  if (remotes.includes('origin')) throw new Error('This repository already has an origin remote.')
  const credential = await azureCredential()
  if (!credential) throw new ForgeError(signInHint, 'signed-out')
  if (!credential.organization) throw new Error(noOrganization)
  const [project, name, ...rest] = input.name.split('/')
  if (!project || !name || rest.length) throw new Error('Name an Azure DevOps repository as project/name.')
  const repo = await azureApi<RawRepository>(
    credential,
    `/${q(credential.organization)}/${q(project)}/_apis/git/repositories`,
    { method: 'POST', body: { name } },
  )
  const [clone] = parseRepositories([repo])
  if (!clone) throw new Error('Azure DevOps created the repository without an HTTPS address.')
  await git(cwd, ['remote', 'add', 'origin', clone.cloneUrl])
  await git(cwd, ['push', '-u', 'origin', 'HEAD'])
}

async function whoAmI(credential: Target, organization: string): Promise<string | null> {
  return azureApi<{ authenticatedUser?: { providerDisplayName?: string } }>(
    credential,
    `/${q(organization)}/_apis/connectionData`,
  )
    .then((data) => data.authenticatedUser?.providerDisplayName ?? null)
    .catch(() => null)
}

export async function repositoryAccount(cwd: string): Promise<ForgeRepositoryAccount> {
  const repo = await azureRepositoryOf(cwd)
  if (!repo) return { origin: null, login: null, source: 'none', ambiguous: false }
  const credential = await azureCredential()
  if (!credential) return { origin: 'dev.azure.com', login: null, source: 'none', ambiguous: false }
  return {
    origin: 'dev.azure.com',
    login: await whoAmI(credential, repo.organization),
    source: 'saved',
    ambiguous: false,
  }
}

const unknown = (detail: string | null = null): ForgeCheckResult => ({ state: 'unknown', detail })

export async function checkAccess(cwd: string): Promise<ForgeAccessReport> {
  const checkedAt = Date.now()
  const repo = await azureRepositoryOf(cwd)
  const none = { source: 'none' as const, login: null, connectionId: null, ambiguous: false }
  if (!repo)
    return {
      origin: null,
      account: none,
      api: { read: unknown('This repository has no Azure DevOps remote.'), write: unknown() },
      transport: unknown(),
      checkedAt,
    }
  const transport = await git(cwd, ['ls-remote', '--exit-code', '--heads', 'origin'])
    .then((): ForgeCheckResult => ({ state: 'ok', detail: null }))
    .catch((): ForgeCheckResult => ({
      state: 'failed',
      detail: 'Git could not reach the remote with this host’s Git credentials.',
    }))
  const credential = await azureCredential()
  if (!credential)
    return {
      origin: 'dev.azure.com',
      account: none,
      api: { read: unknown(signInHint), write: unknown() },
      transport,
      checkedAt,
    }
  const account = {
    source: 'saved' as const,
    login: await whoAmI(credential, repo.organization),
    connectionId: null,
    ambiguous: false,
  }
  try {
    await repoApi({ cwd, repo, credential })
  } catch (error) {
    return {
      origin: 'dev.azure.com',
      account,
      api: { read: { state: 'failed', detail: (error as Error).message }, write: unknown() },
      transport,
      checkedAt,
    }
  }
  return {
    origin: 'dev.azure.com',
    account,
    api: {
      read: { state: 'ok', detail: null },
      // Branch permissions and policies decide this per branch; Azure DevOps does not report it for a token.
      write: unknown('Azure DevOps does not report push permission for a token; opening a pull request shows it.'),
    },
    transport,
    checkedAt,
  }
}

/** Whose token this is in an organization; throws when Azure DevOps refuses it there. Used before saving one. */
export async function verifyAzureToken(credential: Target, organization: string): Promise<string> {
  const data = await azureApi<{ authenticatedUser?: { providerDisplayName?: string } }>(
    credential,
    `/${q(organization)}/_apis/connectionData`,
  )
  const name = data.authenticatedUser?.providerDisplayName
  if (!name) throw new ForgeError('Azure DevOps did not accept this token for that organization.', 'signed-out')
  return name
}

/** What Settings shows: whether a token is set, where from, and when checked, whose it is. */
export async function azureSummary(check: boolean): Promise<AzureSummary> {
  const credential = await azureCredential()
  if (!credential) return { source: null, organization: null, login: null, state: 'unchecked' }
  const base = { source: credential.source, organization: credential.organization ?? null }
  if (!check) return { ...base, login: null, state: 'unchecked' }
  if (!credential.organization)
    return { ...base, login: null, state: 'failed', error: 'Name the organization so Ramu can check this token.' }
  try {
    return { ...base, login: await verifyAzureToken(credential, credential.organization), state: 'ok' }
  } catch (error) {
    return { ...base, login: null, state: 'failed', error: redactSecrets((error as Error).message) }
  }
}

registerForgeAdapter({
  id: 'azure',
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
