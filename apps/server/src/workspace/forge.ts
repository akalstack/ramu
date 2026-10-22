// GitHub pull requests and issues through the `gh` CLI, which brings the user's own sign-in.
// Like git.ts, every call uses an argument array (never a shell string) and an explicit working directory.
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import type {
  ForgeAvailability,
  ForgeCheck,
  ForgeCheckState,
  ForgeConnectionSummary,
  ForgeStatus,
  IssueLink,
  IssueSummary,
  PublishRepositoryInput,
  PullRequestDraft,
  PullRequestFeedbackKind,
  PullRequestInfo,
  PullRequestInput,
  PullRequestReviewDecision,
} from '@ramu/shared/types'
import { parseGhAuthStatus } from '@ramu/shared/forgeAccounts'
import { findExecutable } from '../providers/providerBinaries'
import { branchExists, commitBranchInfo, currentBranch, git, headOid, publishRemote } from './git'

export class ForgeError extends Error {
  constructor(
    message: string,
    readonly availability: ForgeAvailability | null,
  ) {
    super(message)
  }
}

/** Packaged apps may start without the shell's PATH, so look in the usual install locations too. */
function ghExecutable(): string | null {
  return (
    findExecutable('gh') ??
    ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'].find((path) => existsSync(path)) ??
    null
  )
}

/** Maps gh's error output to the reason forge features are unavailable, when it is one of those. */
export function availabilityFromError(stderr: string): ForgeAvailability | null {
  if (/gh auth login|not logged in|authentication required|HTTP 401/i.test(stderr)) return 'signed-out'
  if (/none of the git remotes|not a github|unable to determine|no git remotes/i.test(stderr)) return 'not-github'
  return null
}

const MAX_BUFFER = 32 * 1024 * 1024

export function gh(cwd: string, args: string[]): Promise<string> {
  const executable = ghExecutable()
  if (!executable)
    return Promise.reject(new ForgeError('Install the GitHub CLI (gh) to use pull requests and issues.', 'no-cli'))
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        cwd,
        maxBuffer: MAX_BUFFER,
        encoding: 'utf8',
        timeout: 60_000,
        // Never prompt, page, colour output or check for updates.
        env: {
          ...process.env,
          GH_PROMPT_DISABLED: '1',
          GH_NO_UPDATE_NOTIFIER: '1',
          GH_PAGER: 'cat',
          NO_COLOR: '1',
          GIT_TERMINAL_PROMPT: '0',
        },
      },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout)
        const detail = stderr.trim() || err.message
        reject(new ForgeError(`gh ${args[0]} failed: ${detail}`, availabilityFromError(detail)))
      },
    )
  })
}

/** `gh auth status` writes to stdout or stderr and exits non-zero when any sign-in is bad, so both are read. */
function authStatusText(executable: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      executable,
      ['auth', 'status'],
      {
        encoding: 'utf8',
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' },
      },
      (_error, stdout, stderr) => resolve(`${stdout}\n${stderr}`),
    )
  })
}

/** The GitHub sign-ins already on this host. Read-only: nothing is saved, changed or sent anywhere but to `gh`. */
export async function forgeConnections(
  options: { executable?: string | null; status?: (executable: string) => Promise<string>; now?: number } = {},
): Promise<ForgeConnectionSummary> {
  const checkedAt = options.now ?? Date.now()
  const executable = options.executable === undefined ? ghExecutable() : options.executable
  if (!executable) return { cli: 'no-cli', accounts: [], checkedAt }
  const accounts = parseGhAuthStatus(await (options.status ?? authStatusText)(executable))
  return { cli: accounts.length ? 'signed-in' : 'signed-out', accounts, checkedAt }
}

// ---- Pull requests ----

const PR_FIELDS = 'number,title,url,state,isDraft,baseRefName,headRefName,headRefOid,reviewDecision,statusCheckRollup'

interface RawCheck {
  __typename?: string
  name?: string
  context?: string
  status?: string
  conclusion?: string | null
  state?: string
  detailsUrl?: string
  targetUrl?: string
  startedAt?: string
  completedAt?: string
}

interface RawPullRequest {
  number: number
  title: string
  url: string
  state: string
  isDraft: boolean
  baseRefName: string
  headRefName: string
  headRefOid?: string
  reviewDecision?: string | null
  statusCheckRollup?: RawCheck[] | null
}

function checkState(raw: RawCheck): ForgeCheckState {
  // Commit statuses carry `state`; check runs carry `status` and, once completed, `conclusion`.
  const value = (
    raw.__typename === 'StatusContext' ? raw.state : raw.status === 'COMPLETED' ? raw.conclusion : raw.status
  )?.toUpperCase()
  switch (value) {
    case 'SUCCESS':
    case 'NEUTRAL':
      return 'success'
    case 'FAILURE':
    case 'ERROR':
    case 'TIMED_OUT':
    case 'CANCELLED':
    case 'ACTION_REQUIRED':
    case 'STARTUP_FAILURE':
      return 'failure'
    case 'SKIPPED':
    case 'STALE':
      return 'skipped'
    default:
      return 'pending'
  }
}

/** One result per check name: a re-run (or a second workflow trigger) replaces the earlier one. */
export function parseChecks(raw: RawCheck[]): ForgeCheck[] {
  const latest = new Map<string, RawCheck>()
  for (const check of raw) {
    const name = (check.__typename === 'StatusContext' ? check.context : check.name) ?? ''
    if (!name) continue
    const previous = latest.get(name)
    if (!previous || (check.startedAt ?? '') >= (previous.startedAt ?? '')) latest.set(name, check)
  }
  return [...latest.entries()]
    .map(([name, check]) => ({
      name,
      state: checkState(check),
      url: check.detailsUrl || check.targetUrl || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const REVIEW_DECISION: Record<string, PullRequestReviewDecision> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes-requested',
  REVIEW_REQUIRED: 'review-required',
}

export function parsePullRequest(raw: RawPullRequest): PullRequestInfo {
  const state = raw.state.toUpperCase()
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    state: state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : 'open',
    draft: raw.isDraft,
    baseBranch: raw.baseRefName,
    headBranch: raw.headRefName,
    headCommit: raw.headRefOid,
    reviewDecision: REVIEW_DECISION[raw.reviewDecision ?? ''] ?? null,
    checks: parseChecks(raw.statusCheckRollup ?? []),
  }
}

async function hasRemote(cwd: string): Promise<boolean> {
  return !!(await git(cwd, ['remote']).catch(() => '')).trim()
}

/** The branch name on the remote: the upstream's when it tracks one (local names may differ), else the local name. */
async function remoteBranchName(cwd: string, branch: string): Promise<string> {
  const merge = (await git(cwd, ['config', '--get', `branch.${branch}.merge`]).catch(() => '')).trim()
  return merge.startsWith('refs/heads/') ? merge.slice('refs/heads/'.length) : branch
}

/** The pull request for the checked-out branch, and whether forge features work here at all. */
export async function pullRequestStatus(cwd: string, url?: string): Promise<ForgeStatus> {
  if (!(await hasRemote(cwd))) return { availability: 'no-remote', pullRequest: null }
  if (!ghExecutable()) return { availability: 'no-cli', pullRequest: null }
  const branch = await currentBranch(cwd)
  if (!branch) return { availability: 'ready', pullRequest: null }
  try {
    const head = url ?? (await remoteBranchName(cwd, branch))
    const raw = JSON.parse(await gh(cwd, ['pr', 'view', head, '--json', PR_FIELDS])) as RawPullRequest
    return { availability: 'ready', pullRequest: parsePullRequest(raw) }
  } catch (error) {
    if (error instanceof ForgeError) {
      if (error.availability) return { availability: error.availability, pullRequest: null }
      if (/no (open )?pull requests? found/i.test(error.message)) return { availability: 'ready', pullRequest: null }
    }
    throw error
  }
}

/** The remote-tracking base when it exists, so commits already on the remote base are not counted. */
async function baseRef(cwd: string, branch: string, base: string): Promise<string> {
  const { remote } = await publishRemote(cwd, branch)
  for (const ref of [...(remote ? [`${remote}/${base}`] : []), base])
    if (
      await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).then(
        () => true,
        () => false,
      )
    )
      return ref
  throw new Error(`The base branch ${base} does not exist here. Fetch and try again.`)
}

/** Title and body from the branch's commits, closing the linked issue when there is one. */
export async function pullRequestDraft(cwd: string, issue: IssueLink | null): Promise<PullRequestDraft> {
  const { branch, defaultBranch } = await commitBranchInfo(cwd)
  if (!branch) throw new Error('Switch to a branch before opening a pull request.')
  const base = defaultBranch ?? 'main'
  const onBase = branch === base
  const raw = await git(cwd, [
    'log',
    '--reverse',
    '--format=%s%x1f%b%x1e',
    `${await baseRef(cwd, branch, base)}..HEAD`,
    '--',
  ])
  const commits = raw
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [subject = '', body = ''] = entry.split('\x1f')
      return { subject: subject.trim(), body: body.trim() }
    })
  if (!commits.length)
    throw new Error(
      onBase
        ? `${base} has no commits that are not on the remote. Commit your work first.`
        : `${branch} has no commits that are not on ${base}. Commit your work first.`,
    )
  const title = draftTitle(onBase ? '' : branch, commits)
  return {
    title,
    body: draftBody(commits, issue),
    base,
    branch: onBase ? await freeBranchName(cwd, suggestBranch(title)) : null,
    issue,
  }
}

/** "fix(web): Retry the queue" becomes "fix/retry-the-queue"; anything else gets a "feature/" prefix. */
export function suggestBranch(title: string): string {
  const typed = /^(\w+)(?:\([^)]*\))?!?:\s*(.*)$/.exec(title)
  const kind = typed ? typed[1]!.toLowerCase() : 'feature'
  const slug = (typed ? typed[2]! : title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return `${kind}/${slug || 'changes'}`
}

async function freeBranchName(cwd: string, name: string): Promise<string> {
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? name : `${name}-${n}`
    if (!(await branchExists(cwd, candidate))) return candidate
  }
  return name
}

export function draftTitle(branch: string, commits: { subject: string }[]): string {
  if (commits.length === 1) return commits[0]!.subject
  const name = branch.split('/').pop()!.replace(/[-_]+/g, ' ').trim()
  return name ? name[0]!.toUpperCase() + name.slice(1) : commits[0]!.subject
}

export function draftBody(commits: { subject: string; body: string }[], issue: IssueLink | null): string {
  const parts: string[] = []
  if (commits.length === 1) {
    if (commits[0]!.body) parts.push(commits[0]!.body)
  } else parts.push(commits.map((commit) => `- ${commit.subject}`).join('\n'))
  if (issue) parts.push(`Closes #${issue.number}`)
  return parts.join('\n\n')
}

export async function createPullRequest(cwd: string, input: PullRequestInput): Promise<ForgeStatus> {
  const branch = await currentBranch(cwd)
  if (!branch) throw new Error('Switch to a branch before opening a pull request.')
  const args = ['pr', 'create', '--head', branch, '--base', input.base, '--title', input.title, '--body', input.body]
  if (input.draft) args.push('--draft')
  await gh(cwd, args)
  return pullRequestStatus(cwd)
}

/**
 * Creates the GitHub repository for a local one with no remote and pushes the current branch to it, like VS Code's
 * Publish to GitHub. `gh` adds the `origin` remote before it pushes, so a rejected push leaves a repository that the
 * ordinary Publish branch can finish instead of one to create again.
 */
export async function publishRepository(cwd: string, input: PublishRepositoryInput): Promise<void> {
  if (await hasRemote(cwd)) throw new Error('This repository already has a remote. Publish the branch instead.')
  if (!(await currentBranch(cwd))) throw new Error('Switch to a branch before publishing.')
  if (!(await headOid(cwd)))
    throw new Error('Commit your changes first. A repository with no commits cannot be published.')
  await gh(cwd, [
    'repo',
    'create',
    input.name,
    input.visibility === 'public' ? '--public' : '--private',
    '--source',
    '.',
    '--remote',
    'origin',
    '--push',
  ])
}

// ---- Feedback for an agent ----

const LOG_CHARS = 12_000

/** The part of a job log around its first error, without timestamps or terminal escapes. */
export function failureExcerpt(log: string): string {
  const lines = log
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/, ''))
  const firstError = lines.findIndex((line) => line.startsWith('##[error]'))
  const window =
    firstError < 0
      ? lines.slice(-200)
      : lines.slice(Math.max(0, firstError - 150), Math.min(lines.length, firstError + 30))
  const text = window.join('\n').trim()
  return text.length > LOG_CHARS ? `…${text.slice(-LOG_CHARS)}` : text
}

/** The Actions job id in a check's details link, when the check is a GitHub Actions job. */
export function actionsJobId(url: string | null): string | null {
  return url?.match(/\/actions\/runs\/\d+\/job\/(\d+)/)?.[1] ?? null
}

async function failedChecksFeedback(cwd: string, pr: PullRequestInfo): Promise<string> {
  const failed = pr.checks.filter((check) => check.state === 'failure')
  if (!failed.length) throw new Error(`No checks are failing on pull request #${pr.number}.`)
  const sections: string[] = []
  for (const check of failed) {
    const job = actionsJobId(check.url)
    let log = ''
    if (job)
      log = await gh(cwd, ['api', '--allow-escape-sequences', `repos/{owner}/{repo}/actions/jobs/${job}/logs`]).then(
        failureExcerpt,
        () => '',
      )
    sections.push(
      [
        `### ${check.name}${check.url ? ` (${check.url})` : ''}`,
        log ? ['```', log, '```'].join('\n') : 'No log is available for this check; open its link for details.',
      ].join('\n'),
    )
  }
  return [
    `Fix the failing checks on pull request #${pr.number} (${pr.url}).`,
    '',
    '<ramu-context>',
    `Branch: ${pr.headBranch} → ${pr.baseBranch}`,
    '',
    ...sections,
    '',
    'Work out the cause from the logs and the code, fix it, and run the same check locally when you can.',
    'Commit the fix on this branch. Do not push; I will review and push from Source Control.',
    'Reply briefly: what failed, why, and what you changed. If a failure is flaky or unrelated to this branch, say so instead of changing code.',
    'Say which checks you ran locally and their result. Remote CI cannot pass until the fix is pushed, so report it as pending rather than fixed.',
    '</ramu-context>',
  ].join('\n')
}

interface RawReviewData {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: {
            isResolved: boolean
            isOutdated: boolean
            path: string
            line: number | null
            comments: { nodes: { author: { login: string } | null; body: string }[] }
          }[]
        }
        reviews: { nodes: { state: string; body: string; author: { login: string } | null }[] }
      }
    }
  }
}

const REVIEW_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes { isResolved isOutdated path line comments(first: 30) { nodes { author { login } body } } }
      }
      reviews(last: 30) { nodes { state body author { login } } }
    }
  }
}`

/** Open review threads and review summaries, written as a task for an agent. */
export function reviewFeedbackPrompt(pr: PullRequestInfo, raw: RawReviewData): string | null {
  const data = raw.data.repository.pullRequest
  const author = (node: { author: { login: string } | null }) => node.author?.login ?? 'someone'
  const threads = data.reviewThreads.nodes
    .filter((thread) => !thread.isResolved && thread.comments.nodes.length)
    .map((thread) =>
      [
        `### ${thread.path}${thread.line ? `:${thread.line}` : ''}${thread.isOutdated ? ' (outdated)' : ''}`,
        ...thread.comments.nodes.map((comment) => `- ${author(comment)}: ${comment.body.trim()}`),
      ].join('\n'),
    )
  const reviews = data.reviews.nodes
    .filter((review) => review.body.trim() && review.state !== 'DISMISSED')
    .map((review) => `- ${author(review)} (${review.state.toLowerCase().replace(/_/g, ' ')}): ${review.body.trim()}`)
  if (!threads.length && !reviews.length) return null
  return [
    `Address the open review feedback on pull request #${pr.number} (${pr.url}).`,
    '',
    '<ramu-context>',
    `Branch: ${pr.headBranch} → ${pr.baseBranch}`,
    ...(reviews.length ? ['', '## Reviews', ...reviews] : []),
    ...(threads.length ? ['', '## Open comment threads', ...threads] : []),
    '',
    'Make the requested changes where you agree. Where you disagree or a comment is unclear, leave the code and explain why.',
    'Commit the changes on this branch. Do not push or reply on GitHub; I will review and push from Source Control.',
    'Reply briefly: one line per thread on what you did, and which checks you ran locally. The reviewer has not seen the changes until they are pushed.',
    '</ramu-context>',
  ].join('\n')
}

/** A prompt that hands the pull request's failing checks or open review comments to an agent. */
export async function pullRequestFeedback(cwd: string, kind: PullRequestFeedbackKind, url?: string): Promise<string> {
  const { pullRequest: pr } = await pullRequestStatus(cwd, url)
  if (!pr) throw new Error('This branch has no pull request.')
  if (kind === 'checks') return failedChecksFeedback(cwd, pr)
  const raw = JSON.parse(
    await gh(cwd, [
      'api',
      'graphql',
      '-F',
      'owner={owner}',
      '-F',
      'repo={repo}',
      '-F',
      `number=${pr.number}`,
      '-f',
      `query=${REVIEW_QUERY}`,
    ]),
  ) as RawReviewData
  const prompt = reviewFeedbackPrompt(pr, raw)
  if (!prompt) throw new Error(`Pull request #${pr.number} has no open review comments.`)
  return prompt
}

// ---- Issues ----

interface RawIssue {
  number: number
  title: string
  url: string
  body?: string
  labels?: { name: string }[]
  updatedAt?: string
  comments?: { author: { login: string } | null; body: string }[]
}

export async function listIssues(cwd: string, search: string): Promise<IssueSummary[]> {
  const args = ['issue', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,url,labels,updatedAt']
  if (search.trim()) args.push('--search', search.trim())
  // No GitHub remote, a signed-out CLI or no CLI means no issues, not a failure.
  const output = await gh(cwd, args).catch((error) => {
    if (error instanceof ForgeError && error.availability) return null
    throw error
  })
  if (output === null) return []
  const raw = JSON.parse(output) as RawIssue[]
  return raw.map((issue) => ({
    number: issue.number,
    title: issue.title,
    url: issue.url,
    labels: (issue.labels ?? []).map((label) => label.name),
    updatedAt: issue.updatedAt ? Date.parse(issue.updatedAt) : 0,
  }))
}

const ISSUE_TEXT_CHARS = 20_000

/** The opening message for a chat that works on an issue. */
export function issuePrompt(raw: RawIssue): string {
  const comments = (raw.comments ?? [])
    .filter((comment) => comment.body.trim())
    .map((comment) => `- ${comment.author?.login ?? 'someone'}: ${comment.body.trim()}`)
  const details = [
    raw.body?.trim() || '(No description.)',
    ...(raw.labels?.length ? ['', `Labels: ${raw.labels.map((label) => label.name).join(', ')}`] : []),
    ...(comments.length ? ['', 'Comments:', ...comments] : []),
  ].join('\n')
  return [
    `Work on issue #${raw.number}: ${raw.title}`,
    '',
    '<ramu-context>',
    `Issue: ${raw.url}`,
    '',
    details.length > ISSUE_TEXT_CHARS ? `${details.slice(0, ISSUE_TEXT_CHARS)}…` : details,
    '</ramu-context>',
  ].join('\n')
}

export async function issueDetails(
  cwd: string,
  number: number,
): Promise<{ title: string; url: string; prompt: string }> {
  const raw = JSON.parse(
    await gh(cwd, ['issue', 'view', String(number), '--json', 'number,title,url,body,labels,comments']),
  ) as RawIssue
  return { title: raw.title, url: raw.url, prompt: issuePrompt(raw) }
}
