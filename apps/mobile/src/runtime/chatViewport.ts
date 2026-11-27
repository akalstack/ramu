/** Programmatic jumps keep following enabled; only the reader can leave the latest message. */
export function transcriptScrollState(following: boolean, gap: number, dragging: boolean, settling: boolean) {
  const follow = !settling && dragging ? gap < 40 : following
  return { following: follow, away: !follow && gap > 80 }
}

/**
 * Whether an opening thread has landed and can be shown: rows measured after the first scroll to the end grow the
 * content and leave the list short of it, so it is shown only once it sits on its end. A chat that fits on screen (no
 * end offset) has landed once it has content.
 */
export function openingLanded(end: number | null, offset: number, content: number): boolean {
  return end === null ? content > 0 : Math.abs(offset - end) <= 2
}

/** Native prompts and Control Center report inactive without suspending the app. */
export function appForeground(previous: boolean, next: string): boolean {
  return next === 'inactive' ? previous : next === 'active'
}

/**
 * The row a finished turn should be read from: its answer when the answer is taller than the room on screen, so the
 * reader starts at its first line; null when it fits, or when the turn ended without an answer after the last message.
 */
export function finishedAnswerRow(
  rows: readonly { kind: string }[],
  sizeAt: (index: number) => number,
  room: number,
): number | null {
  const lastUser = rows.findLastIndex((row) => row.kind === 'user')
  const index = rows.findLastIndex((row) => row.kind === 'text')
  if (index < 0 || index < lastUser || room <= 0) return null
  return sizeAt(index) > room ? index : null
}
