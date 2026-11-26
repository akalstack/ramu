import type { PendingSubmission } from './pendingSubmission'

// A message whose send failed is the only copy of what the person wrote: the composer was cleared when it went out.
// It is kept in this client's storage for its host, so closing the thread or restarting the app does not lose it.
const PREFIX = 'ramu.failed-sends.'
/** More than a thread can sensibly hold unsent; past this the oldest go. */
const MAX_ITEMS = 20
const MAX_LENGTH = 400_000

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const isSubmission = (value: unknown): value is PendingSubmission => {
  const item = value as Partial<PendingSubmission> | null
  return (
    !!item &&
    typeof item.id === 'string' &&
    typeof item.text === 'string' &&
    Array.isArray(item.attachments) &&
    Array.isArray(item.queuedIds) &&
    typeof item.afterEvent === 'number' &&
    typeof item.sentAt === 'number' &&
    !!item.payload &&
    typeof item.payload.outgoing === 'string'
  )
}

/** The failed sends kept for a thread, oldest first. Anything unreadable is dropped rather than shown half-restored. */
export function loadFailedSubmissions(store: Store | null, sessionId: string): PendingSubmission[] {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(PREFIX + sessionId) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter(isSubmission).map((item) => ({ ...item, state: 'failed' as const }))
      : []
  } catch {
    return []
  }
}

/** Keeps the thread's failed sends, and forgets the entry once none is left. */
export function saveFailedSubmissions(
  store: Store | null,
  sessionId: string,
  submissions: readonly PendingSubmission[],
): void {
  const failed = submissions.filter((item) => item.state === 'failed').slice(-MAX_ITEMS)
  try {
    if (!failed.length) return store?.removeItem(PREFIX + sessionId)
    const text = JSON.stringify(failed)
    if (text.length <= MAX_LENGTH) store?.setItem(PREFIX + sessionId, text)
  } catch {
    // Storage that is full or unavailable leaves the message where it already is: in the open thread.
  }
}
