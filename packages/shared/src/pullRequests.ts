import type {
  ForgeService,
  PullRequestChecksState,
  PullRequestGroup,
  PullRequestStage,
  PullRequestSummary,
  RepositoryPullRequests,
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

/** One row of the Pull requests page: a pull request with the repository it came from and where it stands. */
export interface PullRequestRow {
  pr: PullRequestSummary
  stage: PullRequestStage
  projectId: string
  projectName: string
  repoId: string
  repoName: string
  threads: { taskId: string; title: string }[]
  /** From a repository in no project: it opens on the hosting service, since Ramu has no checkout of it. */
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
