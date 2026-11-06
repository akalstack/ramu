import type { PullRequestChecksState, PullRequestGroup, PullRequestStage, PullRequestSummary } from './types'

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
