/**
 * Whether the reader's finger is moving a transcript right now. Rebuilding a long thread's rows takes the JavaScript
 * thread for a moment, and the list positions its rows there, so a rebuild in the middle of a scroll shows as a hitch.
 * The store holds streamed updates back while this is set, for a bounded time, and applies them when the scroll rests.
 */
let busy = false
let since = 0

export const scrollBusy = {
  set(moving: boolean, now = Date.now()) {
    if (moving && !busy) since = now
    busy = moving
  },
  /** True while scrolling, for at most `maxMs` of one scroll, so a long fling never starves the transcript. */
  holds(maxMs: number, now = Date.now()): boolean {
    return busy && now - since < maxMs
  },
}

/** How long streamed updates wait for a scroll to rest, and how soon they look again. */
export const SCROLL_HOLD_MS = 1200
export const SCROLL_RECHECK_MS = 120
