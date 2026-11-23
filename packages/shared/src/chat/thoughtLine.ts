import { replyPreview } from './replyPreview'

/**
 * A thought folded to one plain line beside its "Thought" label. Streaming reasoning shows its newest paragraph, so
 * the line follows what the agent is considering now; a finished thought reads from its opening.
 */
export function thoughtLine(text: string, live: boolean): string {
  if (!live) return replyPreview(text)
  return (
    text
      .split(/\n\s*\n/)
      .map(replyPreview)
      .findLast((line) => line.length > 0) ?? ''
  )
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
