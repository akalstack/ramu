/** The shortest thumb a pointer can still grab, however long the content. */
export const MIN_THUMB_PX = 24

/** One axis of a scroll container, with the length of the track its thumb travels in. */
export interface ScrollAxis {
  scroll: number
  scrollSize: number
  clientSize: number
  trackSize: number
}

/** The thumb's length and its distance from the start of the track, or null when there is nothing to scroll. */
export function thumbGeometry({ scroll, scrollSize, clientSize, trackSize }: ScrollAxis) {
  const range = scrollSize - clientSize
  if (range <= 0 || clientSize <= 0 || trackSize <= 0) return null
  const size = Math.min(trackSize, Math.max(MIN_THUMB_PX, (trackSize * clientSize) / scrollSize))
  const progress = Math.min(1, Math.max(0, scroll / range))
  return { size, offset: (trackSize - size) * progress }
}

/** The scroll offset after the thumb is dragged `delta` pixels from where the container was at `scroll`. */
export function dragScroll(axis: ScrollAxis, delta: number): number {
  const thumb = thumbGeometry(axis)
  const travel = thumb ? axis.trackSize - thumb.size : 0
  if (travel <= 0) return axis.scroll
  const range = axis.scrollSize - axis.clientSize
  return Math.min(range, Math.max(0, axis.scroll + (delta * range) / travel))
}
