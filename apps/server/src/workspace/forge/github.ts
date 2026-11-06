// GitHub pull requests and issues through the `gh` CLI, which brings the user's own sign-in.
// Like git.ts, every call uses an argument array (never a shell string) and an explicit working directory.
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import type {
  ForgeAccessReport,
  ForgeAvailability,
  ForgeCheckResult,
  ForgeCheck,
  ForgeCheckState,
  ForgeConnectionSummary,
  ForgeRepositoryAccount,
  ForgeRepositorySummary,
  ForgeStatus,
  IssueLink,
  IssueSummary,
  PublishRepositoryInput,
  PullRequestDraft,
  PullRequestInfo,
  PullRequestInput,
  PullRequestReviewDecision,
} from '@ramu/shared/types'
import { parseGhAuthStatus } from '@ramu/shared/forgeAccounts'
import {
  githubApiBase,
  normalizeOrigin,
  parseForgeRemote,
  redactSecrets,
  type ForgeRemote,
} from '@ramu/shared/forgeRemote'
import type { ForgeAccountStore } from '../forgeAccounts'
import { registerForgeAdapter } from './adapter'
import { findExecutable } from '../../providers/providerBinaries'
import { branchExists, commitBranchInfo, currentBranch, git, headOid, publishRemote } from '../git'
import {
  GithubApiError,
  apiRequest,
  createPull,
  findPullRequest,
  graphql,
  issueDirect,
  jobLog,
  listIssuesDirect,
  repositoriesDirect,
  type ApiAccess,
} from './githubApi'
import * as pulls from './githubPulls'

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
  if (/gh auth login|not logged in|authentication required|HTTP 401|set the GH_TOKEN/i.test(stderr)) return 'signed-out'
  if (/none of the git remotes|not a github|unable to determine|no git remotes/i.test(stderr)) return 'not-github'
  return null
}

const MAX_BUFFER = 32 * 1024 * 1024

let accountStore: ForgeAccountStore | null = null

/** Wires saved connections into every `gh` call. Without it `gh` runs as before, with its own sign-in. */
export function configureForgeAccounts(store: ForgeAccountStore | null): void {
  accountStore = store
  remoteCache.clear()
}

const remoteCache = new Map<string, { at: number; remote: ForgeRemote | null }>()

/** The forge repository behind a checkout's publish remote, from its URL alone. No network request. */
export async function forgeRemoteOf(cwd: string): Promise<ForgeRemote | null> {
  const cached = remoteCache.get(cwd)
  if (cached && Date.now() - cached.at < 10_000) return cached.remote
  let remote: ForgeRemote | null = null
  try {
    const { remote: name } = await publishRemote(cwd, await currentBranch(cwd))
    if (name) remote = parseForgeRemote((await git(cwd, ['remote', 'get-url', name])).trim())
  } catch {
    remote = null
  }
  if (remoteCache.size > 200) remoteCache.clear()
  remoteCache.set(cwd, { at: Date.now(), remote })
  return remote
}

/** The token of one `gh` sign-in, for a call that must use a specific CLI account. Never stored or returned. */
function cliToken(executable: string, origin: string, login: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      ['auth', 'token', '--hostname', origin, '--user', login],
      { encoding: 'utf8', timeout: 15_000, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } },
      (error, stdout) =>
        error || !stdout.trim()
          ? reject(new ForgeError(`The GitHub CLI has no sign-in for ${login} on ${origin}.`, 'signed-out'))
          : resolve(stdout.trim()),
    )
  })
}

/** Environment that makes `gh` act as the chosen account. An ambiguous choice is an error, never a silent pick. */
export async function accountEnvironment(cwd: string, executable: string): Promise<Record<string, string>> {
  if (!accountStore) return {}
  const remote = await forgeRemoteOf(cwd)
  return accountEnvironmentFor(remote?.origin ?? 'github.com', executable, remote?.owner, remote?.repo)
}

async function accountEnvironmentFor(
  origin: string,
  executable: string,
  owner?: string,
  repo?: string,
): Promise<Record<string, string>> {
  if (!accountStore) return {}
  const account = await accountStore.resolve(origin, owner, repo)
  if (account.kind === 'ambiguous')
    throw new ForgeError(
      `Several GitHub accounts are saved for ${origin}. Choose which one this repository uses in Settings → Git.`,
      'choose-account',
    )
  const token =
    account.kind === 'saved' ? account.token : account.login ? await cliToken(executable, origin, account.login) : null
  if (!token) return {}
  return origin === 'github.com' ? { GH_TOKEN: token } : { GH_HOST: origin, GH_ENTERPRISE_TOKEN: token }
}

/**
 * The GitHub token this checkout's calls use (the saved account Settings chose, or the `gh` sign-in), for a hosting
 * platform's Git link that must add a deploy key or webhook. Never stored or returned to a client.
 */
export async function repositoryToken(cwd: string): Promise<string> {
  const executable = ghExecutable()
  const account = executable ? await accountEnvironment(cwd, executable) : {}
  const given = account.GH_TOKEN ?? account.GH_ENTERPRISE_TOKEN ?? (await directAccess(cwd))?.token
  if (given) return given
  if (!executable) throw new ForgeError('Connect GitHub in Settings → Git hosting first.', 'no-cli')
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      ['auth', 'token', '--hostname', 'github.com'],
      { encoding: 'utf8', timeout: 15_000, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } },
      (error, stdout) =>
        error || !stdout.trim()
          ? reject(new ForgeError('Sign in to GitHub on this host first.', 'signed-out'))
          : resolve(stdout.trim()),
    )
  })
}

export async function gh(cwd: string, args: string[]): Promise<string> {
  const executable = ghExecutable()
  if (!executable) throw new ForgeError('Install the GitHub CLI (gh) to use pull requests and issues.', 'no-cli')
  const account = await accountEnvironment(cwd, executable)
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
          ...account,
          GH_PROMPT_DISABLED: '1',
          GH_NO_UPDATE_NOTIFIER: '1',
          GH_PAGER: 'cat',
          NO_COLOR: '1',
          GIT_TERMINAL_PROMPT: '0',
        },
      },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout)
        const detail = redactSecrets(stderr.trim() || err.message)
        reject(new ForgeError(`gh ${args[0]} failed: ${detail}`, availabilityFromError(detail)))
      },
    )
  })
}

/**
 * A saved token for this checkout's GitHub repository, used when the host has no `gh`. Null means `gh` is available
 * (or no saved token applies); several saved accounts without a choice is an error, never a silent pick.
 */
async function directAccess(cwd: string): Promise<ApiAccess | null> {
  if (ghExecutable() || !accountStore) return null
  const remote = await forgeRemoteOf(cwd)
  if (!remote) return null
  const account = await accountStore.resolve(remote.origin, remote.owner, remote.repo)
  if (account.kind === 'ambiguous')
    throw new ForgeError(
      `Several GitHub accounts are saved for ${remote.origin}. Choose which one this repository uses in Settings → Git.`,
      'choose-account',
    )
  return account.kind === 'saved'
    ? { origin: remote.origin, token: account.token, owner: remote.owner, repo: remote.repo }
    : null
}

/** The saved token for an origin when no repository decides it: its selection, or the only one saved. */
async function savedAccessFor(origin: string): Promise<ApiAccess> {
  const account = await accountStore!.resolve(origin)
  if (account.kind === 'ambiguous')
    throw new ForgeError(
      `Several GitHub accounts are saved for ${origin}. Choose one in Settings → Git.`,
      'choose-account',
    )
  if (account.kind !== 'saved')
    throw new ForgeError('Install the GitHub CLI (gh) or save a GitHub token in Settings.', 'no-cli')
  return { origin, token: account.token, owner: '', repo: '' }
}

/** A rejected saved token reads like a signed-out CLI: the availability tells the person what to fix. */
function directFailure(error: unknown): never {
  if (error instanceof GithubApiError && error.unauthorized) throw new ForgeError(error.message, 'signed-out')
  throw error
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
  if (!executable) return { cli: 'no-cli', accounts: [], saved: [], checkedAt }
  const accounts = parseGhAuthStatus(await (options.status ?? authStatusText)(executable))
  return { cli: accounts.length ? 'signed-in' : 'signed-out', accounts, saved: [], checkedAt }
}

/** Detected CLI sign-ins plus the credentials saved on this host. */
export async function connectionSummary(canAdminister: boolean): Promise<ForgeConnectionSummary> {
  const detected = await forgeConnections()
  return accountStore ? { ...detected, ...accountStore.summary(canAdminister) } : detected
}

/** The saved connection a checkout's GitHub calls use, or null for the detected CLI or when none is configured. */
export async function resolvedConnectionId(cwd: string): Promise<string | null> {
  const id = await resolvedAccountChoice(cwd)
  return id && !id.startsWith('cli') ? id : null
}

/**
 * The account identity a checkout's calls use (a connection id, `cli` or `cli:<login>`), read without touching any
 * token. Null when several saved accounts need a choice, or when it cannot be told.
 */
export async function resolvedAccountChoice(cwd: string): Promise<string | null> {
  if (!accountStore) return null
  try {
    const remote = await forgeRemoteOf(cwd)
    return accountStore.choiceId(remote?.origin ?? 'github.com', remote?.owner, remote?.repo)
  } catch {
    return null
  }
}

/** The account this checkout's GitHub calls would use, without any network request. */
export async function repositoryAccount(cwd: string): Promise<ForgeRepositoryAccount> {
  const remote = await forgeRemoteOf(cwd)
  // A repository with no remote yet is about to be published to github.com.
  const origin = remote?.origin ?? 'github.com'
  const none: ForgeRepositoryAccount = { origin, login: null, source: 'none', ambiguous: false }
  if (!accountStore) return none
  const account = await accountStore.resolve(origin, remote?.owner, remote?.repo)
  if (account.kind === 'ambiguous') return { ...none, ambiguous: true }
  return { origin, login: account.login, source: account.kind === 'saved' ? 'saved' : 'cli', ambiguous: false }
}

const unknownCheck = (detail: string | null = null): ForgeCheckResult => ({ state: 'unknown', detail })

/** Runs `git ls-remote`: reads refs through the remote's own transport and credentials, and changes nothing. */
function remoteReachable(cwd: string, remote: string): Promise<ForgeCheckResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['ls-remote', '--heads', remote],
      {
        cwd,
        timeout: 20_000,
        maxBuffer: 4 * 1024 * 1024,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          // A key passphrase or unknown host must fail here instead of waiting for input.
          GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes -o ConnectTimeout=10',
          LC_ALL: 'C',
        },
      },
      (error, _stdout, stderr) => {
        if (!error) return resolve({ state: 'ok', detail: null })
        const text = redactSecrets(stderr.trim() || error.message).split('\n')[0] ?? ''
        const denied = /permission denied|authentication failed|could not read username|access denied|403|publickey/i
        resolve({ state: denied.test(text) ? 'denied' : 'failed', detail: text.slice(0, 300) || null })
      },
    )
  })
}

interface RepositoryRead {
  permissions?: { push?: boolean; admin?: boolean; maintain?: boolean }
}

function readOutcome(status: number): ForgeCheckResult {
  if (status === 401) return { state: 'denied', detail: 'The credential was rejected. It may be expired or revoked.' }
  if (status === 403 || status === 429)
    return {
      state: 'denied',
      detail: 'The server refused the request: a permission is missing or the rate limit was reached.',
    }
  if (status === 404)
    return {
      state: 'denied',
      detail: 'The repository was not found with this account. It may be private or need organization approval.',
    }
  return { state: 'failed', detail: `The server answered with status ${status}.` }
}

/**
 * What the account that would be used can do in this repository: API reads, writes and Git transport are reported
 * separately, and nothing is committed or pushed. A successful identity check elsewhere proves none of this.
 */
export async function checkAccess(
  cwd: string,
  options: { fetch?: typeof fetch; now?: number } = {},
): Promise<ForgeAccessReport> {
  const checkedAt = options.now ?? Date.now()
  const remote = await forgeRemoteOf(cwd)
  const none = { source: 'none' as const, login: null, connectionId: null, ambiguous: false }
  if (!remote)
    return {
      origin: null,
      account: none,
      api: { read: unknownCheck('This repository has no GitHub remote.'), write: unknownCheck() },
      transport: unknownCheck(),
      checkedAt,
    }
  const resolution = accountStore ? await accountStore.resolve(remote.origin, remote.owner, remote.repo) : null
  if (resolution?.kind === 'ambiguous')
    return {
      origin: remote.origin,
      account: { ...none, ambiguous: true },
      api: { read: unknownCheck('Choose an account for this repository first.'), write: unknownCheck() },
      transport: unknownCheck(),
      checkedAt,
    }
  const account =
    resolution?.kind === 'saved'
      ? { source: 'saved' as const, login: resolution.login, connectionId: resolution.connectionId, ambiguous: false }
      : {
          source: 'cli' as const,
          login: resolution?.kind === 'cli' ? resolution.login : null,
          connectionId: null,
          ambiguous: false,
        }
  let read: ForgeCheckResult
  let write: ForgeCheckResult = unknownCheck()
  try {
    let body: RepositoryRead | null = null
    if (resolution?.kind === 'saved') {
      const response = await (options.fetch ?? fetch)(
        `${githubApiBase(remote.origin)}/repos/${remote.owner}/${remote.repo}`,
        {
          headers: {
            Authorization: `Bearer ${resolution.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'Ramu',
          },
          redirect: 'error',
          signal: AbortSignal.timeout(15_000),
        },
      )
      if (response.ok) body = (await response.json()) as RepositoryRead
      else read = readOutcome(response.status)
    } else {
      body = JSON.parse(await gh(cwd, ['api', `repos/${remote.owner}/${remote.repo}`])) as RepositoryRead
    }
    read = body ? { state: 'ok', detail: null } : read!
    if (body) {
      const permissions = body.permissions
      write = !permissions
        ? unknownCheck('The server did not report write permissions.')
        : permissions.push || permissions.admin || permissions.maintain
          ? { state: 'ok', detail: null }
          : { state: 'denied', detail: 'This account can read the repository but not push or open pull requests.' }
    }
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error))
    read =
      error instanceof ForgeError && error.availability
        ? { state: 'denied', detail: message }
        : {
            state: 'failed',
            detail: /redirect/i.test(message)
              ? 'The server redirected the request, so the credential was not sent on.'
              : message.slice(0, 300),
          }
  }
  const { remote: name } = await publishRemote(cwd, await currentBranch(cwd)).catch(() => ({ remote: null }))
  const transport = name ? await remoteReachable(cwd, name) : unknownCheck('No remote is configured.')
  return { origin: remote.origin, account, api: { read, write }, transport, checkedAt }
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

/** Whether GitHub calls can work for this checkout at all: a remote, and a signed-in `gh` or a usable saved token. */
export async function githubAvailability(cwd: string): Promise<ForgeAvailability> {
  if (!(await hasRemote(cwd))) return 'no-remote'
  try {
    const direct = await directAccess(cwd)
    return ghExecutable() || direct ? 'ready' : 'no-cli'
  } catch (error) {
    if (error instanceof ForgeError && error.availability) return error.availability
    throw error
  }
}

/** The pull request for the checked-out branch, and whether forge features work here at all. */
export async function pullRequestStatus(cwd: string, url?: string): Promise<ForgeStatus> {
  if (!(await hasRemote(cwd))) return { availability: 'no-remote', pullRequest: null }
  let direct: ApiAccess | null
  try {
    direct = await directAccess(cwd)
  } catch (error) {
    if (error instanceof ForgeError && error.availability)
      return { availability: error.availability, pullRequest: null }
    throw error
  }
  if (!ghExecutable() && !direct) return { availability: 'no-cli', pullRequest: null }
  const branch = await currentBranch(cwd)
  if (!branch) return { availability: 'ready', pullRequest: null }
  try {
    const head = url ?? (await remoteBranchName(cwd, branch))
    if (direct) {
      const found = await findPullRequest(direct, { ...(url ? { url } : {}), branch: head }).catch(directFailure)
      return { availability: 'ready', pullRequest: found ? parsePullRequest(found as RawPullRequest) : null }
    }
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

/**
 * What a pull request would carry, for a model to describe: the branch's commits, its file summary and as much of
 * its diff as is asked for. Null when the branch has nothing to propose.
 */
export async function pullRequestSource(
  cwd: string,
  maxPatch = 40_000,
): Promise<{ commits: string; files: string; patch: string } | null> {
  const { branch, defaultBranch } = await commitBranchInfo(cwd)
  if (!branch) return null
  const range = `${await baseRef(cwd, branch, defaultBranch ?? 'main')}..HEAD`
  const commits = (await git(cwd, ['log', '--reverse', '--format=- %s%n%b', range, '--'])).trim()
  if (!commits) return null
  const files = (await git(cwd, ['diff', '--stat=200', range, '--']).catch(() => '')).trim()
  const patch = (await git(cwd, ['diff', '--no-color', '--no-ext-diff', range, '--']).catch(() => '')).slice(
    0,
    maxPatch,
  )
  return { commits, files, patch }
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
  try {
    const direct = await directAccess(cwd)
    if (direct)
      await createPull(direct, {
        title: input.title,
        body: input.body,
        head: branch,
        base: input.base,
        draft: input.draft,
      }).catch(directFailure)
    else await gh(cwd, args)
  } catch (error) {
    // A lost reply or a timeout does not say whether the pull request was created. Look at the intended branch with the
    // same account before reporting a failure, so a retry never opens a duplicate.
    const existing = await pullRequestStatus(cwd).catch(() => null)
    if (
      existing?.pullRequest &&
      existing.pullRequest.state === 'open' &&
      existing.pullRequest.baseBranch === input.base
    )
      return existing
    throw error
  }
  return pullRequestStatus(cwd)
}

interface RawRepository {
  fullName?: string
  nameWithOwner?: string
  description?: string | null
  isPrivate?: boolean
  url?: string
  updatedAt?: string
}

/** Repository list entries as clone choices. Entries without a name or an https address are dropped. */
export function parseRepositories(raw: RawRepository[], host = 'github.com'): ForgeRepositorySummary[] {
  const found: ForgeRepositorySummary[] = []
  for (const repository of raw) {
    const fullName = repository.fullName ?? repository.nameWithOwner
    if (!fullName || !/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(fullName)) continue
    let cloneUrl: string
    try {
      const url = new URL(repository.url ?? '')
      // Only the server the list came from: a clone address on another host is dropped, not trusted.
      if (url.protocol !== 'https:' || url.host !== host || url.username || url.password) continue
      cloneUrl = `${url.origin}/${fullName}.git`
    } catch {
      continue
    }
    found.push({
      fullName,
      description: repository.description?.slice(0, 300) || null,
      private: repository.isPrivate === true,
      cloneUrl,
      updatedAt: repository.updatedAt ? Date.parse(repository.updatedAt) || 0 : 0,
    })
  }
  return found
}

const REPOSITORY_FIELDS = 'nameWithOwner,description,isPrivate,url,updatedAt'

/**
 * Repositories to clone: an exact `owner/name` is looked up directly (works for any organization), otherwise the
 * signed-in account's own repositories, most recently updated first, narrowed by the search text.
 */
export async function searchRepositories(
  search: string,
  cwd: string = homedir(),
  /** A GitHub Enterprise server with a saved connection on this host; absent means github.com or the checkout's origin. */
  origin?: string,
): Promise<ForgeRepositorySummary[]> {
  const text = search.trim()
  const exact = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(text)
  if (origin && origin !== 'github.com') {
    const normalized = normalizeOrigin(origin)
    if (!normalized || !accountStore)
      throw new ForgeError('Save a token for that GitHub server in Settings → Git first.', 'no-cli')
    const access = await savedAccessFor(normalized)
    const found = parseRepositories(
      await repositoriesDirect(access, exact ? text : null).catch(directFailure),
      normalized,
    )
    const needle = text.toLowerCase()
    return (
      exact || !needle
        ? found
        : found.filter((r) => `${r.fullName} ${r.description ?? ''}`.toLowerCase().includes(needle))
    )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 50)
  }
  const direct = await directAccess(cwd).catch(() => null)
  if (direct || (!ghExecutable() && accountStore)) {
    const access = direct ?? (await savedAccessFor('github.com'))
    const found = parseRepositories(await repositoriesDirect(access, exact ? text : null).catch(directFailure))
    const needle = text.toLowerCase()
    return (
      exact || !needle
        ? found
        : found.filter((r) => `${r.fullName} ${r.description ?? ''}`.toLowerCase().includes(needle))
    )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 50)
  }
  if (exact) {
    const output = await gh(cwd, ['repo', 'view', text, '--json', REPOSITORY_FIELDS]).catch((error) => {
      if (error instanceof ForgeError) throw error
      return null
    })
    return output ? parseRepositories([JSON.parse(output) as RawRepository]) : []
  }
  const listed = parseRepositories(
    JSON.parse(await gh(cwd, ['repo', 'list', '--limit', '100', '--json', REPOSITORY_FIELDS])) as RawRepository[],
  )
  const needle = text.toLowerCase()
  return (
    needle
      ? listed.filter((repository) =>
          `${repository.fullName} ${repository.description ?? ''}`.toLowerCase().includes(needle),
        )
      : listed
  )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 50)
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
  const direct = await directAccess(cwd).catch(() => null)
  if (!ghExecutable() && accountStore) {
    // Without `gh`: create the repository through the API, add it as origin, then push with the host's own Git credentials.
    const access = direct ?? (await savedAccessFor('github.com'))
    const [owner, name] = input.name.includes('/') ? input.name.split('/') : [null, input.name]
    const me = owner ? await apiRequest<{ login: string }>(access, '/user').catch(directFailure) : null
    const inOrganization = owner && me && owner.toLowerCase() !== me.login.toLowerCase()
    const created = await apiRequest<{ clone_url: string }>(
      access,
      inOrganization ? `/orgs/${owner}/repos` : '/user/repos',
      {
        method: 'POST',
        body: { name, private: input.visibility !== 'public' },
      },
    ).catch(directFailure)
    await git(cwd, ['remote', 'add', 'origin', created.clone_url])
    await git(cwd, ['push', '-u', 'origin', (await currentBranch(cwd))!])
    return
  }
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
    if (job) {
      const direct = await directAccess(cwd).catch(() => null)
      log = await (
        direct
          ? jobLog(direct, job)
          : gh(cwd, ['api', '--allow-escape-sequences', `repos/{owner}/{repo}/actions/jobs/${job}/logs`])
      ).then(failureExcerpt, () => '')
    }
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

/** A prompt that hands the pull request's failing checks to an agent. */
export async function checksFeedback(cwd: string, url?: string): Promise<string> {
  const { pullRequest: pr } = await pullRequestStatus(cwd, url)
  if (!pr) throw new Error('This branch has no pull request.')
  return failedChecksFeedback(cwd, pr)
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
  const direct = await directAccess(cwd).catch(() => null)
  if (direct) {
    const found = await listIssuesDirect(direct, search).catch((error) => {
      if (error instanceof GithubApiError && error.unauthorized) return []
      throw error
    })
    return found.map((issue) => ({
      number: issue.number,
      title: issue.title,
      url: issue.url,
      labels: issue.labels,
      updatedAt: issue.updatedAt ? Date.parse(issue.updatedAt) : 0,
    }))
  }
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
  const direct = await directAccess(cwd)
  const raw = direct
    ? ((await issueDirect(direct, number).catch(directFailure)) as RawIssue)
    : (JSON.parse(
        await gh(cwd, ['issue', 'view', String(number), '--json', 'number,title,url,body,labels,comments']),
      ) as RawIssue)
  return { title: raw.title, url: raw.url, prompt: issuePrompt(raw) }
}

/** GitHub behind the shared adapter boundary: `gh` when it is signed in, otherwise the direct API with a saved token. */
registerForgeAdapter({
  id: 'github',
  listPullRequests: pulls.listPullRequests,
  mergeOptions: pulls.mergeOptions,
  pullRequestAction: pulls.pullRequestAction,
  pullRequestBody: pulls.pullRequestBody,
  reviewThreads: pulls.reviewThreads,
  replyToThread: pulls.replyToThread,
  resolveThread: pulls.resolveThread,
  requestReviews: pulls.requestReviews,
  submitReview: pulls.submitReview,
  repositoryAccount,
  checkAccess,
  pullRequestStatus,
  pullRequestDraft,
  createPullRequest,
  checksFeedback,
  listIssues,
  issueDetails,
  publishRepository,
  searchRepositories,
})

/** A repository webhook Ramu created for a schedule, so it can update or remove it later. */
export interface RepoHook {
  origin: string
  owner: string
  repo: string
  id: number
}
export interface RepoHookConfig {
  url: string
  secret: string
  events: string[]
}

/**
 * One call to the repository-hooks API, through a saved token or `gh`. The body (which holds the secret) reaches `gh`
 * through a private temporary file, never its arguments, where other processes could read it.
 */
export async function githubRest<T>(cwd: string, method: string, path: string, body?: unknown): Promise<T> {
  const direct = await directAccess(cwd)
  if (direct)
    return apiRequest<T>(direct, path, { method, ...(body === undefined ? {} : { body }) }).catch(directFailure)
  if (body === undefined) {
    const out = await gh(cwd, ['api', path.slice(1), '--method', method])
    return (out.trim() ? JSON.parse(out) : null) as T
  }
  return withBodyFile(body, async (file) => {
    const out = await gh(cwd, ['api', path.slice(1), '--method', method, '--input', file])
    return (out.trim() ? JSON.parse(out) : null) as T
  })
}

/** A request body for `gh` in a private temporary file, so its text never appears in a process's arguments. */
async function withBodyFile<T>(body: unknown, use: (file: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'ramu-gh-'))
  const file = join(dir, 'body.json')
  try {
    await writeFile(file, JSON.stringify(body), { mode: 0o600 })
    return await use(file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** One GraphQL document against the checkout's GitHub server, through a saved token or `gh`. */
export async function githubGraphql<T>(cwd: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const direct = await directAccess(cwd)
  if (direct) return (await graphql<{ data: T }>(direct, query, variables).catch(directFailure)).data
  const result = await withBodyFile(
    { query, variables },
    async (file) =>
      JSON.parse(await gh(cwd, ['api', 'graphql', '--input', file])) as { data: T; errors?: { message: string }[] },
  )
  if (result.errors?.length) throw new ForgeError(redactSecrets(result.errors[0]!.message), null)
  return result.data
}

const hookBody = (config: RepoHookConfig) => ({
  active: true,
  events: config.events,
  config: { url: config.url, content_type: 'json', secret: config.secret, insecure_ssl: '0' },
})

/** Creates a webhook on the checkout's GitHub repository. Needs admin rights on it (or a token with repository hooks). */
export async function createRepoHook(cwd: string, config: RepoHookConfig): Promise<RepoHook> {
  const remote = await forgeRemoteOf(cwd)
  if (!remote) throw new ForgeError('This checkout has no GitHub remote.', 'no-remote')
  const created = await githubRest<{ id: number }>(cwd, 'POST', `/repos/${remote.owner}/${remote.repo}/hooks`, {
    name: 'web',
    ...hookBody(config),
  })
  return { origin: remote.origin, owner: remote.owner, repo: remote.repo, id: created.id }
}

export async function updateRepoHook(cwd: string, hook: RepoHook, config: RepoHookConfig): Promise<void> {
  await githubRest(cwd, 'PATCH', `/repos/${hook.owner}/${hook.repo}/hooks/${hook.id}`, hookBody(config))
}

export async function deleteRepoHook(cwd: string, hook: RepoHook): Promise<void> {
  await githubRest(cwd, 'DELETE', `/repos/${hook.owner}/${hook.repo}/hooks/${hook.id}`)
}
