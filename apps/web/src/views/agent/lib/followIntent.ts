/**
 * Whether the reader let go of the latest output, decided from what they did rather than from where the transcript
 * is. The scroller releases on any upward move away from the end, and the browser makes such moves by itself: rows
 * above fold while a large block arrives below, and scroll anchoring pulls the view up in the same frame. That
 * release never re-arms, so the chat would stop following. Only an upward move the reader caused counts here.
 */
export type FollowIntent = {
  released: boolean
  lastTop: number
  pointerDown: boolean
  /** When the reader last pressed, clicked or used a key outside a text field: what they start scrolls with. */
  inputAt: number
}

/** A press, click or key starts a scroll within a frame or two; anything later is not its doing. */
export const INPUT_SCROLL_MS = 300
/** The scroller's own band for "at the end". */
const END_PX = 8
const MOVED_PX = 0.5

export const newFollowIntent = (top = 0): FollowIntent => ({
  released: false,
  lastTop: top,
  pointerDown: false,
  inputAt: -Infinity,
})

/** A wheel turned up or a finger moved over the transcript. `releaseFollow` sends the same wheel. */
export function gestured(intent: FollowIntent, gesture: { kind: 'wheel'; deltaY: number } | { kind: 'touch' }) {
  if (gesture.kind === 'touch' || gesture.deltaY < 0) intent.released = true
}

/** A press, a release of one, or a key outside a text field. */
export function pressed(intent: FollowIntent, now: number, pointer?: 'down' | 'up') {
  intent.inputAt = now
  if (pointer) intent.pointerDown = pointer === 'down'
}

/** The transcript moved. `gap` is what is left below the view. */
export function scrolled(intent: FollowIntent, top: number, gap: number, now: number) {
  const up = top < intent.lastTop - MOVED_PX
  intent.lastTop = top
  if (up) {
    // Dragging the scrollbar or a selection, or a click or key that brings something above into view.
    if (intent.pointerDown || now - intent.inputAt < INPUT_SCROLL_MS) intent.released = true
  } else if (gap <= END_PX) intent.released = false
}
