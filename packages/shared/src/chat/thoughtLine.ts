import { replyPreview } from './replyPreview'

/**
 * A thought folded to one plain line beside its "Thought" label. A finished thought reads from its opening. While it
 * streams the line moves a paragraph at a time: it shows the newest paragraph the agent has finished, never the one
 * still being written, so a thought that has only just begun has no line yet and its row says "Thinking".
 */
export function thoughtLine(text: string, live: boolean): string {
  if (!live) return replyPreview(text)
  const blocks = text.split(/\n\s*\n/)
  // The last piece is the paragraph in progress; text that ends on a break left an empty one there.
  return (
    blocks
      .slice(0, -1)
      .map(replyPreview)
      .findLast((line) => line.length > 0) ?? ''
  )
}

/** The last paragraph of a thought that has ended, for a group still at work that keeps its latest thought in view. */
export function thoughtEnding(text: string): string {
  return (
    text
      .split(/\n\s*\n/)
      .map(replyPreview)
      .findLast((line) => line.length > 0) ?? ''
  )
}

/** Which paragraph of a thought its live line shows, so the line changes a block at a time as a reply does. */
export function thoughtBlock(text: string): number {
  return text.split(/\n\s*\n/).filter((block) => replyPreview(block).length > 0).length
}

/** A thought shorter than this reads just "Thought"; a longer one says how long it took. */
export const LONG_THOUGHT_MS = 1000

/** When a thought on screen started streaming, and how long it took once it ended. */
export interface ThoughtClock {
  startedAt: number | null
  took: number | null
}

export const NEW_THOUGHT: ThoughtClock = { startedAt: null, took: null }

/**
 * The clock of a thought seen streaming (`live`) or not at `now`. It starts the first time the thought is seen live and
 * stops when it ends, so a thought that had already finished when it came on screen has no duration to show.
 */
export function tickThought(clock: ThoughtClock, live: boolean, now: number): ThoughtClock {
  if (live) return clock.startedAt === null ? { startedAt: now, took: null } : clock
  return clock.startedAt === null ? clock : { startedAt: null, took: now - clock.startedAt }
}

/** What a thought's row is titled: "Thinking" while it streams, then "Thought for 4s" when it took a while, or "Thought". */
export type ThoughtTitle = { label: 'Thinking' | 'Thought' } | { label: 'Thought for {0}'; took: number }

export function thoughtTitle(live: boolean, took: number | null): ThoughtTitle {
  if (live) return { label: 'Thinking' }
  return took !== null && took >= LONG_THOUGHT_MS ? { label: 'Thought for {0}', took } : { label: 'Thought' }
}
