import type {
  ForgeService,
  MergeRules,
  PullRequestChecksState,
  PullRequestFile,
  PullRequestGroup,
  PullRequestStage,
  PullRequestSummary,
  PullRequestThread,
  PullRequestWaiting,
  RepositoryPullRequests,
  TaskPullRequest,
} from './types'

/** Ramu's own facts about a pull request that the hosting service does not know. */
export interface PullRequestLocalState {
  /** Drafted replies or a drafted review are waiting for the person. */
  draftsReady?: boolean
  /** An agent is working on the pull request's feedback now. */
  agentWorking?: boolean
}

/** The one stage a pull request is in, most pressing first, so every surface names it the same way. */
export function pullRequestStage(
  pr: Pick<PullRequestSummary, 'state' | 'draft' | 'checks' | 'reviewDecision' | 'mergeable' | 'openThreads'>,
  local: PullRequestLocalState = {},
): PullRequestStage {
  if (pr.state === 'merged') return 'merged'
  if (pr.state === 'closed') return 'closed'
  if (local.draftsReady) return 'replies-ready'
  if (local.agentWorking) return 'agent-working'
  if (pr.mergeable === 'conflicts') return 'conflicts'
  if (pr.checks === 'failure') return 'checks-failing'
  if (pr.reviewDecision === 'changes-requested') return 'changes-requested'
  if (pr.draft) return 'draft'
  if (pr.checks === 'pending') return 'checks-pending'
  if (pr.reviewDecision === 'approved' && !pr.openThreads && pr.mergeable !== 'blocked') return 'ready'
  return 'review-required'
}

/**
 * What an open pull request waits on people for, from what the service reports of it and, when known, the rules of the
 * branch it merges into. Null when it waits on nobody: it is approved with nothing left to resolve, or not open.
 */
export function pullRequestWaiting(
  pr: Pick<
    PullRequestSummary,
    'state' | 'reviewDecision' | 'openThreads' | 'requestedReviewers' | 'approvedBy' | 'changesRequestedBy'
  >,
  rules: MergeRules | null = null,
): PullRequestWaiting | null {
  if (pr.state !== 'open') return null
  const approved = pr.approvedBy?.length ?? 0
  // The count still missing when the rules say how many; "someone" when the service only says review is required.
  const approvals =
    rules?.approvals !== undefined
      ? Math.max(0, rules.approvals - approved)
      : pr.reviewDecision === 'review-required'
        ? null
        : 0
  const conversations = rules?.conversations ? (pr.openThreads ?? 0) : 0
  const changesBy = pr.reviewDecision === 'changes-requested' ? (pr.changesRequestedBy ?? []) : []
  const needsReview = approvals !== 0 || pr.reviewDecision === 'review-required'
  // Every required approval is in and review is still required: the missing one is a code owner's.
  const codeOwner = !!rules?.codeOwners && pr.reviewDecision === 'review-required' && approvals === 0
  if (!needsReview && !conversations && pr.reviewDecision !== 'changes-requested') return null
  return {
    approvals: codeOwner ? 1 : approvals,
    from: needsReview || codeOwner ? pr.requestedReviewers : [],
    codeOwner,
    conversations,
    changesBy,
    queue: !!rules?.queue,
  }
}

/**
 * Why a pull request waits, in one line, the same on every device: "needs 1 more approval from @ana", "changes
 * requested by @bo", "2 conversations to resolve". Reviewers are named as the service names them.
 */
export function pullRequestWaitingLine(
  waiting: PullRequestWaiting,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const names = (list: string[]) => list.map((name) => `@${name}`).join(', ')
  const parts: string[] = []
  if (waiting.changesBy.length) parts.push(t('changes requested by {0}', { 0: names(waiting.changesBy) }))
  else if (waiting.codeOwner)
    parts.push(
      waiting.from.length
        ? t('needs a code owner’s approval from {0}', { 0: names(waiting.from) })
        : t('needs a code owner’s approval'),
    )
  else if (waiting.approvals === null)
    parts.push(
      waiting.from.length ? t('waiting on review from {0}', { 0: names(waiting.from) }) : t('no reviewer asked yet'),
    )
  else if (waiting.approvals > 0) {
    const need =
      waiting.approvals === 1 ? t('needs 1 more approval') : t('needs {0} more approvals', { 0: waiting.approvals })
    parts.push(waiting.from.length ? t('{0} from {1}', { 0: need, 1: names(waiting.from) }) : need)
  }
  if (waiting.conversations)
    parts.push(
      waiting.conversations === 1
        ? t('1 conversation to resolve')
        : t('{0} conversations to resolve', { 0: waiting.conversations }),
    )
  return parts.join(' · ')
}

/** The colour a stage is drawn in: the theme's tokens, with merged in the accent like the hosting services do. */
export type PullRequestTone = 'ok' | 'warn' | 'bad' | 'muted' | 'accent'

export const PULL_REQUEST_STAGE_TONE: Record<PullRequestStage, PullRequestTone> = {
  'replies-ready': 'warn',
  'agent-working': 'accent',
  conflicts: 'bad',
  'checks-failing': 'bad',
  'changes-requested': 'warn',
  draft: 'muted',
  'checks-pending': 'muted',
  'review-required': 'ok',
  ready: 'ok',
  merged: 'accent',
  closed: 'bad',
}

/** English source strings for `t()`; both apps translate them through their own catalogs. */
export const PULL_REQUEST_STAGE_LABEL: Record<PullRequestStage, string> = {
  'replies-ready': 'Replies ready',
  'agent-working': 'Agent working',
  conflicts: 'Has conflicts',
  'checks-failing': 'Checks failing',
  'changes-requested': 'Changes requested',
  draft: 'Draft',
  'checks-pending': 'Checks running',
  'review-required': 'Waiting on review',
  ready: 'Ready to merge',
  merged: 'Merged',
  closed: 'Closed',
}

/**
 * A stage in words, with the reason in its place when the pull request waits on people and the service said for what:
 * "needs 1 more approval from @ana" instead of "Waiting on review".
 */
export function pullRequestStageDetail(
  pr: Pick<TaskPullRequest, 'stage' | 'waiting'>,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const waits =
    pr.waiting && (pr.stage === 'review-required' || pr.stage === 'changes-requested')
      ? pullRequestWaitingLine(pr.waiting, t)
      : ''
  return waits || t(PULL_REQUEST_STAGE_LABEL[pr.stage])
}

/**
 * How a pull request row reads where its next step is the person's: what an agent prepared, when it prepared
 * something, otherwise its stage. Both apps pass their own `t`.
 */
export function pullRequestRowDetail(
  pr: Pick<TaskPullRequest, 'number' | 'stage' | 'prepared' | 'waiting'>,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const what =
    pr.stage === 'replies-ready' && pr.prepared
      ? pr.prepared.kind === 'review'
        ? t('Review drafted')
        : t(pr.prepared.count === 1 ? '1 reply drafted' : '{0} replies drafted', { 0: pr.prepared.count })
      : pullRequestStageDetail(pr, t)
  return `#${pr.number} · ${what}`
}

/** Stages where the next step is the person's, so Inbox and the phone can surface them. */
export function stageNeedsYou(stage: PullRequestStage): boolean {
  return stage === 'replies-ready' || stage === 'ready' || stage === 'conflicts'
}

/** Which icon a pull request uses: the hosting services' shapes for open, draft, merged and closed. */
export function pullRequestGlyph(pr: { state: PullRequestSummary['state']; draft: boolean }) {
  if (pr.state === 'merged') return 'merged' as const
  if (pr.state === 'closed') return 'closed' as const
  return pr.draft ? ('draft' as const) : ('open' as const)
}

const GROUP_ORDER: PullRequestGroup[] = ['mine', 'review', 'other']

/** Rows split into Yours, Review requested and Other, each newest first; empty groups are left out. */
export function groupPullRequests<T extends Pick<PullRequestSummary, 'group' | 'updatedAt'>>(
  rows: T[],
): { group: PullRequestGroup; rows: T[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    rows: rows.filter((row) => row.group === group).sort((a, b) => b.updatedAt - a.updatedAt),
  })).filter((entry) => entry.rows.length)
}

/** Matches a search against number, title, author and branch. */
export function matchesPullRequest(
  pr: Pick<PullRequestSummary, 'number' | 'title' | 'author' | 'headBranch'>,
  search: string,
): boolean {
  const words = search.trim().toLowerCase().replace(/^#/, '').split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const haystack = `${pr.number} ${pr.title} ${pr.author ?? ''} ${pr.headBranch}`.toLowerCase()
  return words.every((word) => haystack.includes(word))
}

/** Many checks as one state: any failure, else anything still running, else passed; null with none that count. */
export function checksRollup(
  checks: { state: 'pending' | 'success' | 'failure' | 'skipped' }[],
): PullRequestChecksState {
  if (checks.some((check) => check.state === 'failure')) return 'failure'
  if (checks.some((check) => check.state === 'pending')) return 'pending'
  return checks.some((check) => check.state === 'success') ? 'success' : null
}

/** The tabs of the Pull requests page, the same on the desktop and the phone. */
export type PullRequestFilter = 'needs-you' | 'mine' | 'review' | 'open' | 'closed'

export const PULL_REQUEST_FILTERS: PullRequestFilter[] = ['needs-you', 'mine', 'review', 'open', 'closed']

/** English source strings for `t()`. */
export const PULL_REQUEST_FILTER_LABEL: Record<PullRequestFilter, string> = {
  'needs-you': 'Needs you',
  mine: 'Yours',
  review: 'To review',
  open: 'All open',
  closed: 'Closed',
}

const OUTSIDE_REPO = /^outside:([A-Za-z0-9][A-Za-z0-9_-]{0,38})\/([A-Za-z0-9._-]{1,100})$/

/** The repository id of a GitHub repository no project holds, listed for the pull requests that involve the person. */
export const outsideRepoId = (repository: string) => `outside:${repository}`

/** The `owner/repo` an `outside:` repository id names; null for a project's repository or a malformed id. */
export function outsideRepository(repoId: string): string | null {
  const match = OUTSIDE_REPO.exec(repoId)
  if (!match || match[2] === '.' || match[2] === '..') return null
  return `${match[1]}/${match[2]}`
}

/** One row of the Pull requests page: a pull request with the repository it came from and where it stands. */
export interface PullRequestRow {
  pr: PullRequestSummary
  stage: PullRequestStage
  projectId: string
  projectName: string
  repoId: string
  repoName: string
  threads: { taskId: string; title: string }[]
  /** From a repository in no project: Ramu reads and acts on it through the service alone, with no checkout. */
  outside: boolean
  /** The hosting service it lives on. */
  service: ForgeService
}

/** Each hosting service's own name, as people know it. */
export const FORGE_NAMES: Record<ForgeService, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
  azure: 'Azure DevOps',
}

/** A pull request's number the way its service writes it: GitLab and Azure DevOps use `!12`, the others `#12`. */
export function pullRequestRef(service: ForgeService, number: number): string {
  return `${service === 'gitlab' || service === 'azure' ? '!' : '#'}${number}`
}

/** Every repository's pull requests as one list, newest change first. */
export function pullRequestRows(repositories: RepositoryPullRequests[]): PullRequestRow[] {
  return repositories
    .flatMap((repo) =>
      repo.pullRequests.map((pr) => ({
        pr,
        stage: pullRequestStage(pr, repo.local[pr.url]),
        projectId: repo.projectId,
        projectName: repo.projectName,
        repoId: repo.repoId,
        repoName: repo.repoName,
        threads: repo.threads?.[pr.url] ?? [],
        outside: !!repo.outside,
        // A list without a service is GitHub's, as the type documents.
        service: repo.service ?? 'github',
      })),
    )
    .sort((a, b) => b.pr.updatedAt - a.pr.updatedAt)
}

/** A row of the Pull requests page as one host lists it. */
export interface HostPullRequestRow extends PullRequestRow {
  host: string
}

/**
 * A pull request on the Pull requests page across hosts: shown once however many hosts have a checkout of its
 * repository, and opened on the host in `host`. `sources` holds every host's row, that one first.
 */
export interface MergedPullRequestRow extends HostPullRequestRow {
  sources: HostPullRequestRow[]
}

/**
 * Every host's pull requests as one list, newest change first. A pull request listed by several hosts opens where the
 * work on it is: a host with a checkout before one without, then a host with a thread on it, then the earliest host in
 * `preferred` (the one on screen first), then the order of `hosts`.
 */
export function mergedPullRequestRows(
  hosts: { host: string; repositories: RepositoryPullRequests[] }[],
  preferred: readonly string[] = [],
): MergedPullRequestRow[] {
  const rank = (row: HostPullRequestRow) => {
    const index = preferred.indexOf(row.host)
    return [row.outside ? 1 : 0, row.threads.length ? 0 : 1, index < 0 ? preferred.length : index]
  }
  const before = (a: HostPullRequestRow, b: HostPullRequestRow) => {
    const [x, y] = [rank(a), rank(b)]
    const at = x.findIndex((value, i) => value !== y[i])
    return at < 0 ? 0 : x[at]! - y[at]!
  }
  const byUrl = new Map<string, HostPullRequestRow[]>()
  for (const { host, repositories } of hosts)
    for (const row of pullRequestRows(repositories)) {
      const list = byUrl.get(row.pr.url) ?? []
      list.push({ ...row, host })
      byUrl.set(row.pr.url, list)
    }
  return [...byUrl.values()]
    .map((list) => {
      const sources = [...list].sort(before)
      return { ...sources[0]!, sources }
    })
    .sort((a, b) => b.pr.updatedAt - a.pr.updatedAt)
}

/**
 * Names a repository the same on every host, for the page's repository filter: hosts with a checkout of one
 * repository list it under the same project and repository names.
 */
export const pullRequestRepoKey = (entry: { service?: ForgeService; projectName: string; repoName: string }) =>
  [entry.service ?? 'github', entry.projectName, entry.repoName].join('\n')

/**
 * Whether the next step on an open pull request is the person's: a review someone asked of them, or one of their own
 * that is ready to merge, has replies drafted, or is blocked on conflicts, failing checks or requested changes.
 */
export function pullRequestNeedsYou(row: Pick<PullRequestRow, 'pr' | 'stage'>): boolean {
  if (row.pr.state !== 'open') return false
  if (row.pr.group === 'review') return true
  return (
    row.pr.group === 'mine' &&
    (stageNeedsYou(row.stage) || row.stage === 'checks-failing' || row.stage === 'changes-requested')
  )
}

export function inPullRequestFilter(row: Pick<PullRequestRow, 'pr' | 'stage'>, filter: PullRequestFilter): boolean {
  if (filter === 'closed') return row.pr.state !== 'open'
  if (row.pr.state !== 'open') return false
  if (filter === 'needs-you') return pullRequestNeedsYou(row)
  if (filter === 'mine') return row.pr.group === 'mine'
  if (filter === 'review') return row.pr.group === 'review'
  return true
}

/** The search on the Pull requests page also matches the project and repository a row came from. */
export function matchesPullRequestRow(row: PullRequestRow, search: string): boolean {
  const words = search.trim().toLowerCase().replace(/^#/, '').split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const haystack =
    `${row.pr.number} ${row.pr.title} ${row.pr.author ?? ''} ${row.pr.headBranch} ${row.projectName} ${row.repoName} ${FORGE_NAMES[row.service]}`.toLowerCase()
  return words.every((word) => haystack.includes(word))
}

/** How the Pull requests page orders its rows. */
export type PullRequestSort = 'updated' | 'readiness'

/** Closest to merging first: ready, then waiting on checks or review, then blocked, drafts last. */
const READINESS: PullRequestStage[] = [
  'ready',
  'checks-pending',
  'review-required',
  'replies-ready',
  'agent-working',
  'changes-requested',
  'checks-failing',
  'conflicts',
  'draft',
  'merged',
  'closed',
]

/** Rows by most recent change, or by how close each is to merging (newest first within a stage). */
export function sortPullRequestRows<T extends Pick<PullRequestRow, 'pr' | 'stage'>>(
  rows: T[],
  sort: PullRequestSort,
): T[] {
  const sorted = [...rows].sort((a, b) => b.pr.updatedAt - a.pr.updatedAt)
  if (sort === 'updated') return sorted
  return sorted.sort((a, b) => READINESS.indexOf(a.stage) - READINESS.indexOf(b.stage))
}

/** One line of a pull request file's diff, with the line numbers on either side where it has them. */
export interface PatchRow {
  kind: 'hunk' | 'add' | 'del' | 'context' | 'note'
  text: string
  /** The line in the base version; absent on an added line. */
  old?: number
  /** The line in the pull request's version, which inline comments attach to; absent on a removed line. */
  new?: number
}

/** A file's unified diff hunks as rows numbered from each hunk header, as the services' own diff views number them. */
export function patchRows(patch: string): PatchRow[] {
  const rows: PatchRow[] = []
  let oldLine = 0
  let newLine = 0
  for (const line of patch.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (header) {
      oldLine = Number(header[1])
      newLine = Number(header[2])
      rows.push({ kind: 'hunk', text: line })
    } else if (line.startsWith('+')) rows.push({ kind: 'add', text: line.slice(1), new: newLine++ })
    else if (line.startsWith('-')) rows.push({ kind: 'del', text: line.slice(1), old: oldLine++ })
    // "\ No newline at end of file" belongs to the line above and has no number of its own.
    else if (line.startsWith('\\')) rows.push({ kind: 'note', text: line.slice(1).trim() })
    else rows.push({ kind: 'context', text: line.slice(1), old: oldLine++, new: newLine++ })
  }
  return rows
}

/** The one thing to do next on a pull request, which its Overview offers first, as GitHub's Overview page does. */
export type PullRequestNextStep =
  | 'merge'
  | 'fix-checks'
  | 'resolve-conflicts'
  | 'update-branch'
  | 'address-comments'
  | 'send-replies'
  | 'mark-ready'
  | 'review'
  | 'wait-checks'
  | 'wait-review'
  | 'wait-agent'
  | 'none'

/**
 * What comes next, most pressing first: on one's own pull request the fixes are one's own (failing checks, requested
 * changes, conflicts); on someone else's, the review is.
 */
export function pullRequestNextStep(
  pr: Pick<PullRequestSummary, 'state' | 'draft' | 'mergeable' | 'checks'>,
  stage: PullRequestStage,
  mine: boolean,
): PullRequestNextStep {
  if (pr.state !== 'open') return 'none'
  switch (stage) {
    case 'replies-ready':
      return 'send-replies'
    case 'agent-working':
      return 'wait-agent'
    case 'conflicts':
      return mine ? 'resolve-conflicts' : 'review'
    case 'checks-failing':
      return mine ? 'fix-checks' : 'review'
    case 'changes-requested':
      return mine ? 'address-comments' : 'wait-review'
    case 'draft':
      return mine ? 'mark-ready' : 'none'
    case 'checks-pending':
      return 'wait-checks'
    case 'ready':
      return 'merge'
    default:
      if (pr.mergeable === 'behind') return 'update-branch'
      return mine ? 'wait-review' : 'review'
  }
}

export type ReviewThreadFilter = 'open' | 'resolved' | 'all'

/** The review threads a filter shows, in the order picked: by their latest comment, as GitHub's Overview sorts them. */
export function shownReviewThreads(
  threads: readonly PullRequestThread[],
  filter: ReviewThreadFilter,
  order: 'newest' | 'oldest',
  search = '',
): PullRequestThread[] {
  const last = (entry: PullRequestThread) => entry.comments.at(-1)?.createdAt ?? 0
  return threads
    .filter((entry) => (filter === 'all' ? true : filter === 'open' ? !entry.resolved : entry.resolved))
    .filter((entry) => matchesReviewThread(entry, search))
    .sort((a, b) => (order === 'newest' ? last(b) - last(a) : last(a) - last(b)))
}

const searchWords = (search: string) => search.trim().toLowerCase().split(/\s+/).filter(Boolean)

/** Whether every word of a search is in a review thread's file, its authors or what they wrote. */
export function matchesReviewThread(thread: PullRequestThread, search: string): boolean {
  const words = searchWords(search)
  if (!words.length) return true
  const haystack = [thread.path ?? '', ...thread.comments.map((comment) => `${comment.author ?? ''} ${comment.body}`)]
    .join('\n')
    .toLowerCase()
  return words.every((word) => haystack.includes(word))
}

/** Whether every word of a search is in a changed file's path or its diff, so a file is found by name or by code. */
export function matchesPullRequestFile(file: Pick<PullRequestFile, 'path' | 'previousPath' | 'patch'>, search: string) {
  const words = searchWords(search)
  if (!words.length) return true
  const haystack = `${file.path}\n${file.previousPath ?? ''}\n${file.patch ?? ''}`.toLowerCase()
  return words.every((word) => haystack.includes(word))
}

/** Whether one diff line holds a word of the search, so the lines that made a file match can be marked. */
export function diffLineMatches(text: string, search: string): boolean {
  const words = searchWords(search)
  if (!words.length) return false
  const line = text.toLowerCase()
  return words.some((word) => line.includes(word))
}
