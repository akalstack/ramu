import { FORGE_NAMES } from './pullRequests'
import type { ForgeService, PullRequestCapability, PullRequestReaction } from './types'

const ALL: Record<PullRequestCapability, true> = {
  comment: true,
  reply: true,
  'line-comment': true,
  suggestion: true,
  approve: true,
  'request-changes': true,
  'withdraw-review': true,
  resolve: true,
  unresolve: true,
  'thread-status': true,
  'edit-comment': true,
  'delete-comment': true,
  reactions: true,
  reviewers: true,
  'remove-reviewers': true,
  labels: true,
  assignees: true,
  draft: true,
  'auto-merge': true,
  'rerun-checks': true,
  'base-branch': true,
}

/**
 * What each hosting service's API lets Ramu do with a pull request. Agents' tools refuse what is missing in words, and
 * the Pull requests page shows only the buttons that work, so the two never disagree.
 */
export const PULL_REQUEST_SUPPORT: Record<ForgeService, Record<PullRequestCapability, boolean>> = {
  // Thread statuses beyond resolved are Azure DevOps's own.
  github: { ...ALL, 'thread-status': false },
  // GitLab's API has no "request changes" verdict to submit.
  gitlab: { ...ALL, 'request-changes': false, 'thread-status': false },
  bitbucket: {
    ...ALL,
    suggestion: false,
    'thread-status': false,
    reactions: false,
    labels: false,
    assignees: false,
    'auto-merge': false,
  },
  azure: { ...ALL, assignees: false },
}

/** The reactions a service offers; Azure DevOps has only likes. */
export const PULL_REQUEST_REACTIONS: Record<ForgeService, PullRequestReaction[]> = {
  github: ['thumbs-up', 'thumbs-down', 'laugh', 'hooray', 'confused', 'heart', 'rocket', 'eyes'],
  gitlab: ['thumbs-up', 'thumbs-down', 'laugh', 'hooray', 'confused', 'heart', 'rocket', 'eyes'],
  bitbucket: [],
  azure: ['thumbs-up'],
}

const MISSING: Record<PullRequestCapability, string> = {
  comment: 'comments on pull requests',
  reply: 'replies in review threads',
  'line-comment': 'line comments',
  suggestion: 'suggested changes',
  approve: 'approvals',
  'request-changes': 'a “request changes” verdict',
  'withdraw-review': 'a way to take back a review',
  resolve: 'resolving threads',
  unresolve: 'reopening resolved threads',
  'thread-status': 'thread statuses besides resolved',
  'edit-comment': 'editing comments',
  'delete-comment': 'deleting comments',
  reactions: 'reactions',
  reviewers: 'reviewers',
  'remove-reviewers': 'removing reviewers',
  labels: 'labels',
  assignees: 'assignees',
  draft: 'draft pull requests',
  'auto-merge': 'merging automatically when checks pass',
  'rerun-checks': 'a way to run checks again',
  'base-branch': 'changing the base branch',
}

export const supportsPullRequest = (service: ForgeService, capability: PullRequestCapability) =>
  PULL_REQUEST_SUPPORT[service][capability]

/** The sentence an agent repeats when a service lacks something, such as "Bitbucket has no labels." */
export const unsupportedPullRequestText = (service: ForgeService, capability: PullRequestCapability) =>
  `${FORGE_NAMES[service]} has no ${MISSING[capability]}.`
