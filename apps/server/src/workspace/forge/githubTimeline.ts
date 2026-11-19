import type { PullRequestTimelineEvent } from '@ramu/shared/types'
import { githubGraphql } from './github'
import { pullRequestTarget } from './githubPulls'
import { TIMELINE_LENGTH, opening } from './adapter'

const TIMELINE_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $last: Int!) {
  repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
    timelineItems(last: $last, itemTypes: [PULL_REQUEST_COMMIT, PULL_REQUEST_REVIEW, ISSUE_COMMENT,
      REVIEW_REQUESTED_EVENT, HEAD_REF_FORCE_PUSHED_EVENT, READY_FOR_REVIEW_EVENT, MERGED_EVENT, CLOSED_EVENT,
      REOPENED_EVENT]) {
      nodes {
        __typename
        ... on PullRequestCommit { url commit { messageHeadline committedDate author { user { login } name } } }
        ... on PullRequestReview { url state submittedAt author { login } body }
        ... on IssueComment { url createdAt author { login } body }
        ... on ReviewRequestedEvent { createdAt actor { login }
          requestedReviewer { ... on User { login } ... on Team { slug } } }
        ... on HeadRefForcePushedEvent { createdAt actor { login } }
        ... on ReadyForReviewEvent { createdAt actor { login } }
        ... on MergedEvent { createdAt actor { login } }
        ... on ClosedEvent { createdAt actor { login } }
        ... on ReopenedEvent { createdAt actor { login } }
      }
    }
  } }
}`

type Node = { __typename: string } & Record<string, unknown>

const VERDICT: Record<string, PullRequestTimelineEvent['verdict']> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes-requested',
  COMMENTED: 'commented',
  DISMISSED: 'dismissed',
}

const login = (value: unknown) => (value as { login?: string } | null)?.login ?? null
const time = (value: unknown) => (typeof value === 'string' ? Date.parse(value) || 0 : 0)

/** One GitHub timeline item as Ramu's event; null for an item it does not show (such as a pending review). */
export function timelineEvent(node: Node): PullRequestTimelineEvent | null {
  switch (node.__typename) {
    case 'PullRequestCommit': {
      const commit = node.commit as {
        messageHeadline?: string
        committedDate?: string
        author?: { user?: { login?: string } | null; name?: string } | null
      }
      return {
        kind: 'commit',
        actor: commit.author?.user?.login ?? commit.author?.name ?? null,
        at: time(commit.committedDate),
        ...(opening(commit.messageHeadline) ? { text: opening(commit.messageHeadline) } : {}),
        ...(typeof node.url === 'string' ? { url: node.url } : {}),
      }
    }
    case 'PullRequestReview': {
      const verdict = VERDICT[String(node.state)]
      if (!verdict || !node.submittedAt) return null
      const text = opening(node.body)
      return {
        kind: 'review',
        actor: login(node.author),
        at: time(node.submittedAt),
        verdict,
        ...(text ? { text } : {}),
        ...(typeof node.url === 'string' ? { url: node.url } : {}),
      }
    }
    case 'IssueComment': {
      const text = opening(node.body)
      return {
        kind: 'comment',
        actor: login(node.author),
        at: time(node.createdAt),
        ...(text ? { text } : {}),
        ...(typeof node.url === 'string' ? { url: node.url } : {}),
      }
    }
    case 'ReviewRequestedEvent': {
      const reviewer = node.requestedReviewer as { login?: string; slug?: string } | null
      const name = reviewer?.login ?? reviewer?.slug
      return {
        kind: 'review-requested',
        actor: login(node.actor),
        at: time(node.createdAt),
        ...(name ? { text: name } : {}),
      }
    }
    case 'HeadRefForcePushedEvent':
      return { kind: 'force-pushed', actor: login(node.actor), at: time(node.createdAt) }
    case 'ReadyForReviewEvent':
      return { kind: 'ready', actor: login(node.actor), at: time(node.createdAt) }
    case 'MergedEvent':
      return { kind: 'merged', actor: login(node.actor), at: time(node.createdAt) }
    case 'ClosedEvent':
      return { kind: 'closed', actor: login(node.actor), at: time(node.createdAt) }
    case 'ReopenedEvent':
      return { kind: 'reopened', actor: login(node.actor), at: time(node.createdAt) }
    default:
      return null
  }
}

/** The latest history of `url`, oldest first: commits, reviews, comments, review requests and state changes. */
export async function pullRequestTimeline(cwd: string, url: string): Promise<PullRequestTimelineEvent[]> {
  const { owner, repo, number } = await pullRequestTarget(cwd, url)
  const data = await githubGraphql<{
    repository: { pullRequest: { timelineItems: { nodes: Node[] } } | null } | null
  }>(cwd, TIMELINE_QUERY, { owner, repo, number, last: TIMELINE_LENGTH })
  const nodes = data.repository?.pullRequest?.timelineItems.nodes ?? []
  return nodes.flatMap((node) => {
    const event = timelineEvent(node)
    return event ? [event] : []
  })
}
