import type { ForgeService, PullRequestSummary, ReviewVerdict } from './types'
import { supportsPullRequest } from './pullRequestSupport'
import type { PullRequestNextStep } from './pullRequests'

export type ReadinessTone = 'ok' | 'warn' | 'bad' | 'muted'

/** One line of where an open pull request stands: an English copy key with its values, and how it reads. */
export interface ReadinessRow {
  key: 'checks' | 'review' | 'merge' | 'conversations'
  tone: ReadinessTone
  text: string
  values?: Record<string, string | number>
}

/**
 * Where an open pull request stands, as GitHub's Overview leads with it: checks, reviews, whether it merges cleanly
 * and what is still unresolved. Copy keys are the desktop's, so both read the same.
 */
export function readinessRows(pr: PullRequestSummary, openThreads: number): ReadinessRow[] {
  const checks: ReadinessRow =
    pr.checks === 'success'
      ? { key: 'checks', tone: 'ok', text: 'All checks passed' }
      : pr.checks === 'failure'
        ? { key: 'checks', tone: 'bad', text: 'Checks failing' }
        : pr.checks === 'pending'
          ? { key: 'checks', tone: 'warn', text: 'Checks running' }
          : { key: 'checks', tone: 'muted', text: 'No checks' }
  const review: ReadinessRow =
    pr.reviewDecision === 'approved'
      ? { key: 'review', tone: 'ok', text: 'Approved' }
      : pr.reviewDecision === 'changes-requested'
        ? { key: 'review', tone: 'warn', text: 'Changes requested' }
        : pr.requestedReviewers.length
          ? {
              key: 'review',
              tone: 'muted',
              text: 'Review requested from {0}',
              values: { 0: pr.requestedReviewers.join(', ') },
            }
          : { key: 'review', tone: 'muted', text: 'Waiting on review' }
  const merge: ReadinessRow =
    pr.mergeable === 'conflicts'
      ? { key: 'merge', tone: 'bad', text: 'Has conflicts with its base branch' }
      : pr.mergeable === 'behind'
        ? { key: 'merge', tone: 'warn', text: 'Behind its base branch' }
        : pr.mergeable === 'blocked'
          ? { key: 'merge', tone: 'warn', text: 'Blocked by the branch rules' }
          : pr.mergeable === 'clean'
            ? { key: 'merge', tone: 'ok', text: 'No conflicts with its base branch' }
            : { key: 'merge', tone: 'muted', text: 'Mergeability not known yet' }
  const conversations: ReadinessRow = openThreads
    ? { key: 'conversations', tone: 'warn', text: '{0} unresolved conversations', values: { 0: openThreads } }
    : { key: 'conversations', tone: 'ok', text: 'All conversations resolved' }
  return [checks, review, merge, conversations]
}

/** The action each next step offers, as an English copy key; waiting steps offer none. */
export const READINESS_ACTION: Partial<Record<PullRequestNextStep, string>> = {
  merge: 'Merge…',
  'fix-checks': 'Fix failing checks',
  'resolve-conflicts': 'Resolve conflicts',
  'update-branch': 'Update branch',
  'address-comments': 'Address review comments',
  'mark-ready': 'Ready for review',
  review: 'Review with agent',
}

/** What a waiting step says instead of offering an action. */
export const READINESS_WAITING: Partial<Record<PullRequestNextStep, string>> = {
  'send-replies': 'Replies are drafted below, waiting for you to check and send them.',
  'wait-checks': 'Waiting for checks to finish.',
  'wait-review': 'Waiting for a review.',
  'wait-agent': 'An agent is working on the feedback.',
}

/**
 * The next step a pull request offers here. A repository in no project has no checkout, so there is no thread to fix,
 * resolve or review in: those steps wait until it is cloned as a project.
 */
export function readinessStep(suggested: PullRequestNextStep, outside: boolean): PullRequestNextStep {
  return outside &&
    (suggested === 'review' ||
      suggested === 'fix-checks' ||
      suggested === 'address-comments' ||
      suggested === 'resolve-conflicts')
    ? 'none'
    : suggested
}

/** The verdicts the person's review can give: only a comment on their own pull request, and what the service has. */
export function reviewVerdicts(service: ForgeService, own: boolean): ReviewVerdict[] {
  const verdicts: ReviewVerdict[] = ['comment']
  if (own) return verdicts
  if (supportsPullRequest(service, 'approve')) verdicts.push('approve')
  if (supportsPullRequest(service, 'request-changes')) verdicts.push('request-changes')
  return verdicts
}

/**
 * Whether a review needs a summary or a line comment before it can go. A plain comment review has nothing else to
 * send anywhere, and GitHub refuses a request for changes without one; Bitbucket and Azure DevOps record a change
 * request as a status of its own, and an approval may say nothing on any service.
 */
export function reviewNeedsWords(service: ForgeService, verdict: ReviewVerdict): boolean {
  return verdict === 'comment' || (verdict === 'request-changes' && service === 'github')
}
