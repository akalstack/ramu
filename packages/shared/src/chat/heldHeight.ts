/** The least height a live tool group keeps, and until when it waits after the person opened or folded part of it. */
export interface HeightHold {
  min: number
  pausedUntil: number
}

export const NO_HOLD: HeightHold = { min: 0, pausedUntil: 0 }

/** A little longer than a row's 200 ms disclosure, so the hold picks up from where the fold settled, not mid-motion. */
export const HOLD_PAUSE_MS = 250

/**
 * The next hold for a group measured at `height`. While the group is live it keeps the tallest height it has reached,
 * so lines that come and go inside it (a thought, a running call's preview, a status line) only ever push the
 * transcript down instead of pulling it up and down under the reader. Once the group is no longer live the hold lets
 * go in one step and the group settles at its own height. The same hold comes back when nothing changes, so a caller
 * can skip the update.
 */
export function holdHeight(hold: HeightHold, height: number, live: boolean, now: number): HeightHold {
  if (!live) return hold.min || hold.pausedUntil ? NO_HOLD : hold
  if (now < hold.pausedUntil) return hold
  const min = Math.max(hold.min, Math.ceil(height))
  return min === hold.min && !hold.pausedUntil ? hold : { min, pausedUntil: 0 }
}

/** The person opened or folded the group or a row in it: the hold lets go so that shows, and restarts once it settles. */
export function releaseHold(now: number): HeightHold {
  return { min: 0, pausedUntil: now + HOLD_PAUSE_MS }
}
