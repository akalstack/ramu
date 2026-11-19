import type { ChangeReview } from '../types'

/** One navigation entry per chat, with immutable changed-run revisions inside. */
export function reviewGroups(reviews: ChangeReview[]): { taskId: string; revisions: ChangeReview[] }[] {
  const groups = new Map<string, ChangeReview[]>()
  for (const review of [...reviews].sort((a, b) => b.createdAt - a.createdAt)) {
    if (!review.files.length) continue
    const revisions = groups.get(review.taskId) ?? []
    revisions.push(review)
    groups.set(review.taskId, revisions)
  }
  return [...groups].map(([taskId, revisions]) => ({ taskId, revisions }))
}

/** Steering can create several transcript turns within one captured run. */
export function reviewsByTurn(
  reviews: ChangeReview[],
  sessionId: string,
  turns: { key: number; sequences: number[] }[],
): Map<number, ChangeReview[]> {
  const assigned = new Map<number, ChangeReview[]>()
  for (const review of reviews.filter((r) => r.sessionId === sessionId && r.files.length > 0 && r.state === 'ready')) {
    const target = turns.findLast((turn) =>
      turn.sequences.some((seq) => seq > (review.startSeq ?? 0) && seq <= (review.endSeq ?? 0)),
    )
    if (target) assigned.set(target.key, [...(assigned.get(target.key) ?? []), review])
  }
  return assigned
}
