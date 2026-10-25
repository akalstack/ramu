import type { ChangeReview } from '@ramu/shared/types'
import { lineChanges } from '@ramu/shared/chat/fileTools'
import type { TranscriptItem } from './types'

type ChangesItem = Extract<TranscriptItem, { kind: 'changes' }>

/** One finished review as a card: each file's +/- lines (counted from its snapshots when the host sent no totals). */
export function changesItem(review: ChangeReview): ChangesItem {
  const files = review.files.map((file) => {
    const counted =
      file.addedLines === undefined || file.removedLines === undefined
        ? file.binary
          ? { added: 0, removed: 0 }
          : lineChanges(file.oldContent, file.newContent)
        : { added: file.addedLines, removed: file.removedLines }
    return { id: file.id, path: file.path, additions: counted.added, deletions: counted.removed }
  })
  return {
    kind: 'changes',
    id: `changes-${review.id}`,
    reviewId: review.id,
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    undone: review.files.every((file) => review.undoFileIds?.includes(file.id)),
  }
}

/**
 * Places each finished review of this session at the end of the turn it recorded, like desktop `reviewsByTurn`: just
 * before the first message sent after the review's last event, or at the end of the transcript.
 */
export function withChangeCards(
  items: TranscriptItem[],
  reviews: readonly ChangeReview[],
  sessionId: string | null | undefined,
): TranscriptItem[] {
  const ready = reviews
    .filter((review) => review.sessionId === sessionId && review.state === 'ready' && review.files.length > 0)
    .sort((a, b) => (a.endSeq ?? 0) - (b.endSeq ?? 0))
  if (!ready.length) return items
  const out = [...items]
  for (const review of [...ready].reverse()) {
    const next = out.findIndex(
      (item) => item.kind === 'user' && item.seq !== undefined && item.seq > (review.endSeq ?? Infinity),
    )
    out.splice(next < 0 ? out.length : next, 0, changesItem(review))
  }
  return out
}
