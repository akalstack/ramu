import type { PullRequestInfo } from './types'
import type { ShipActivity, ShipProjectStatus } from './types/ship'

// Ship carries a thread's change toward a finish line: fixing checks and handling review rounds without the person
// pressing each step, and stopping where the project says. Decisions (approving, merging, production) stay theirs.

/** In the order a change reaches them; a later one includes every earlier one. */
export const FINISH_LINES = ['pull-request', 'review', 'merged', 'preview', 'live'] as const
export type FinishLine = (typeof FINISH_LINES)[number]

/** English copy keys for each finish line, translated where they are shown. */
export const FINISH_LINE_LABEL: Record<FinishLine, string> = {
  'pull-request': 'Pull request',
  review: 'Ready for review',
  merged: 'Merged',
  preview: 'Preview deploy',
  live: 'Live in production',
}

/** The earlier of two finish lines; a missing one sets no limit. */
export function earlierFinishLine(a: FinishLine, b: FinishLine | null | undefined): FinishLine {
  if (!b) return a
  return FINISH_LINES.indexOf(b) < FINISH_LINES.indexOf(a) ? b : a
}

export interface ShipLimits {
  /** Rounds of fixing failing checks the loop runs before asking the person. */
  maxCiFixes: number
  /** Rounds of review comments the loop answers before asking the person. */
  maxReviewRounds: number
}

export const DEFAULT_SHIP_LIMITS: ShipLimits = { maxCiFixes: 3, maxReviewRounds: 5 }
export const MAX_SHIP_ROUNDS = 20

/** What Ramu can tell about a repository without asking the person. */
interface ShipRepository {
  /** The repository is on a Git host that has pull requests. */
  onGitHost: boolean
  /** It belongs to the signed-in account rather than an organization or someone else. */
  personal: boolean
  /** The project has a live address to check after a production deploy. */
  liveAddress: boolean
}

/**
 * The finish line a project starts with: a team's repository stops where people review, a personal one goes as far as
 * Ramu can check it. Without a Git host there is no pull request to stop at, so the loop ends with its commits.
 */
export function defaultFinishLine(repository: ShipRepository): FinishLine {
  if (!repository.onGitHost) return 'pull-request'
  if (!repository.personal) return 'review'
  return repository.liveAddress ? 'live' : 'merged'
}

/**
 * Where a shipping pull request is: still being worked on, at its finish line, or waiting for the next step only the
 * person decides (merging) or the agent starts (deploying after the merge).
 */
export type ShipStep = 'working' | 'reached' | 'merge' | 'deploy' | 'closed'

export function shipStep(
  pr: Pick<PullRequestInfo, 'state' | 'draft' | 'reviewDecision' | 'checks'>,
  finishLine: FinishLine,
): ShipStep {
  if (pr.state === 'closed') return 'closed'
  const at = FINISH_LINES.indexOf(finishLine)
  if (pr.state === 'merged') return at <= FINISH_LINES.indexOf('merged') ? 'reached' : 'deploy'
  const green = pr.checks.every((check) => check.state !== 'failure' && check.state !== 'pending')
  if (pr.draft || !green) return 'working'
  if (finishLine === 'pull-request') return 'reached'
  if (pr.reviewDecision !== 'approved') return 'working'
  return finishLine === 'review' ? 'reached' : 'merge'
}

/** The finish lines a project may choose: those up to the repository's committed limit. */
export const reachableFinishLines = (status: Pick<ShipProjectStatus, 'repositoryLimit'>): FinishLine[] =>
  FINISH_LINES.filter(
    (line) => !status.repositoryLimit || FINISH_LINES.indexOf(line) <= FINISH_LINES.indexOf(status.repositoryLimit),
  )

/** What shipping does for this project, in the person's language, worded the same on every device. */
export function shipExplanation(
  status: ShipProjectStatus,
  t: (key: string, values?: Record<string, string | number>) => string,
): string[] {
  return [
    t(
      'Ask an agent to ship and it fixes failing checks and handles review rounds on its own, up to {0} and {1} rounds, then stops at {2}. Approving, merging and production deploys still ask you.',
      {
        0: status.limits.maxCiFixes,
        1: status.limits.maxReviewRounds,
        2: t(FINISH_LINE_LABEL[status.finishLine]),
      },
    ),
    ...(status.repositoryLimit
      ? [t('This repository’s ramu.json stops shipping at {0}.', { 0: t(FINISH_LINE_LABEL[status.repositoryLimit]) })]
      : []),
  ]
}

/** How one thing Ship did unasked reads in Inbox's Done, the same on every device. */
export function shipActivityText(
  entry: Pick<ShipActivity, 'number' | 'from' | 'to' | 'undoneAt'>,
  t: (key: string, values?: Record<string, string | number>) => string,
): { title: string; detail: string } {
  return {
    title: entry.number === null ? t('Fixed failing checks') : t('Fixed failing checks on #{0}', { 0: entry.number }),
    detail: entry.undoneAt
      ? t('Undone with a revert')
      : t('Pushed {0}..{1}', { 0: entry.from.slice(0, 7), 1: entry.to.slice(0, 7) }),
  }
}
