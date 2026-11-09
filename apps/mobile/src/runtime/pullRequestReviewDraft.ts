import type { PendingComment } from '../components/PullRequestReview'

/** Where a pull request's unsent review waits among the phone's drafts, per host and pull request. */
export const reviewDraftKey = (computerId: string, url: string) => `pr-review:${computerId}:${url}`

/** The pending line comments a draft holds; anything unreadable counts as none. */
export function readReviewDraft(text: string | undefined): PendingComment[] {
  if (!text) return []
  try {
    const saved = JSON.parse(text) as unknown
    return Array.isArray(saved)
      ? saved.filter(
          (entry): entry is PendingComment =>
            !!entry &&
            typeof entry.id === 'string' &&
            typeof entry.path === 'string' &&
            Number.isInteger(entry.line) &&
            (entry.startLine === undefined || Number.isInteger(entry.startLine)) &&
            typeof entry.body === 'string',
        )
      : []
  } catch {
    return []
  }
}

/** An empty review clears its draft. */
export const writeReviewDraft = (comments: PendingComment[]) => (comments.length ? JSON.stringify(comments) : '')
