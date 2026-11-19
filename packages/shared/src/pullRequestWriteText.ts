import type { PullRequestThreadStatus, PullRequestWrite, PullRequestWriteItem } from './types'

/** English source text for `t()` with its values; both apps translate it through their own catalogs. */
export interface WriteText {
  text: string
  values?: Record<string, string>
}

const STATUS: Record<PullRequestThreadStatus, string> = {
  active: 'Reopen thread',
  resolved: 'Resolve thread',
  'wont-fix': 'Mark thread won’t fix',
  'by-design': 'Mark thread by design',
  closed: 'Close thread',
}

const ACTION = {
  merge: 'Merge',
  'auto-merge': 'Merge when checks pass',
  close: 'Close pull request',
  reopen: 'Reopen pull request',
  ready: 'Mark ready for review',
  draft: 'Back to draft',
  'update-branch': 'Update branch',
} as const

/** What one write does, as the card's row names it. */
export function pullRequestWriteTitle(write: PullRequestWrite): WriteText {
  switch (write.kind) {
    case 'comment':
      return { text: 'Comment' }
    case 'reply':
      return { text: 'Reply in thread' }
    case 'line-comment':
      return { text: 'Comment on {0}', values: { '0': `${write.comment.path}:${write.comment.line}` } }
    case 'review':
      return {
        text:
          write.verdict === 'approve' ? 'Approve' : write.verdict === 'request-changes' ? 'Request changes' : 'Review',
      }
    case 'thread-status':
      return { text: STATUS[write.status] }
    case 'edit-comment':
      return { text: 'Edit comment' }
    case 'delete-comment':
      return { text: 'Delete comment' }
    case 'react':
      return {
        text: write.remove ? 'Remove reaction {0}' : 'React {0}',
        values: { '0': REACTION_EMOJI[write.reaction] },
      }
    case 'reviewers':
      return { text: 'Change reviewers' }
    case 'withdraw-review':
      return { text: 'Withdraw your review' }
    case 'update':
      return { text: write.update.base !== undefined ? 'Change base branch' : 'Change pull request' }
    case 'action':
      return { text: ACTION[write.action.kind] }
    case 'rerun-checks':
      return { text: 'Re-run failed checks' }
  }
}

export const REACTION_EMOJI = {
  'thumbs-up': '👍',
  'thumbs-down': '👎',
  laugh: '😄',
  hooray: '🎉',
  confused: '😕',
  heart: '❤️',
  rocket: '🚀',
  eyes: '👀',
} as const

/** The text a write posts, shown as the service will render it; null for writes with no text. */
export function pullRequestWriteBody(write: PullRequestWrite): string | null {
  switch (write.kind) {
    case 'comment':
    case 'reply':
    case 'edit-comment':
      return write.body
    case 'line-comment':
      return write.comment.suggestion === undefined
        ? write.comment.body
        : `${write.comment.body}\n\n\`\`\`suggestion\n${write.comment.suggestion}\n\`\`\``
    case 'review':
      return write.body || null
    case 'update':
      return write.update.body ?? null
    default:
      return null
  }
}

/** Plain facts under a write's title: who is added or removed, the new title or base, how it merges. */
export function pullRequestWriteDetail(write: PullRequestWrite): string | null {
  switch (write.kind) {
    case 'reviewers':
      return [...write.add.map((name) => `+${name}`), ...write.remove.map((name) => `−${name}`)].join(' ')
    case 'update':
      return (
        [
          write.update.title !== undefined ? `“${write.update.title}”` : '',
          write.update.base !== undefined ? `→ ${write.update.base}` : '',
          ...(write.update.labels?.add ?? []).map((label) => `+${label}`),
          ...(write.update.labels?.remove ?? []).map((label) => `−${label}`),
          ...(write.update.assignees?.add ?? []).map((name) => `+@${name}`),
          ...(write.update.assignees?.remove ?? []).map((name) => `−@${name}`),
        ]
          .filter(Boolean)
          .join(' ') || null
      )
    case 'action':
      return write.action.kind === 'merge' || write.action.kind === 'auto-merge' ? write.action.method : null
    default:
      return null
  }
}

/** Whether the person can still edit a waiting write's text in the card. */
export const editableWrite = (item: PullRequestWriteItem) =>
  (item.state === 'waiting' || item.state === 'failed') &&
  ['comment', 'reply', 'line-comment', 'edit-comment', 'review'].includes(item.write.kind)
