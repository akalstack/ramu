/** A quick read finishes before a person would notice; only one that lasts earns a status line. */
const SHOW_DELAY_MS = 400
/** Once shown, a status stays long enough to be read rather than blink. */
const MIN_VISIBLE_MS = 400

/**
 * A status that shows only after it has stayed set for a moment, then stays for a minimum time, so a fast sync never
 * flashes on screen. `key` scopes it to one thread: opening another thread starts over instead of carrying it across.
 */
export type DelayedStatus<A> =
  | { readonly phase: 'idle'; readonly key: string }
  | { readonly phase: 'pending'; readonly key: string; readonly showAt: number }
  | { readonly phase: 'shown'; readonly key: string; readonly value: A; readonly holdUntil: number }

/**
 * The next state for the current `value` (compared by identity) at time `now`. Returns `state` itself when nothing
 * changes, so a caller can run it on every render.
 */
export function stepDelayedStatus<A>(
  state: DelayedStatus<A> | null,
  key: string,
  value: A | null,
  now: number,
): DelayedStatus<A> {
  const idle: DelayedStatus<A> = { phase: 'idle', key }
  const pending = (): DelayedStatus<A> => ({ phase: 'pending', key, showAt: now + SHOW_DELAY_MS })
  const shown = (next: A): DelayedStatus<A> => ({ phase: 'shown', key, value: next, holdUntil: now + MIN_VISIBLE_MS })
  if (!state || state.key !== key) return value === null ? idle : pending()
  switch (state.phase) {
    case 'idle':
      return value === null ? state : pending()
    case 'pending':
      if (value === null) return idle
      return now >= state.showAt ? shown(value) : state
    case 'shown':
      if (value === null) return now >= state.holdUntil ? idle : state
      return value === state.value ? state : shown(value)
  }
}

/** When the state next changes on its own, or null when it waits for the value to change. */
export function delayedStatusDeadline<A>(state: DelayedStatus<A>): number | null {
  if (state.phase === 'pending') return state.showAt
  if (state.phase === 'shown') return state.holdUntil
  return null
}

export function shownDelayedStatus<A>(state: DelayedStatus<A>): A | null {
  return state.phase === 'shown' ? state.value : null
}
