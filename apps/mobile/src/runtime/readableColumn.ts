/**
 * The widest a screen's content grows, its own padding included. On a phone every screen is narrower, so nothing changes;
 * on a tablet or a wide split, lists, settings, the transcript and its composer share one centered column instead of
 * stretching rows and lines of text across the whole display.
 */
export const READABLE_WIDTH = 760

/** Extra space on each side that centers a `READABLE_WIDTH` column in a view `width` points wide. */
export function readableGutter(width: number, max: number = READABLE_WIDTH): number {
  if (!Number.isFinite(width) || width <= max) return 0
  return Math.floor((width - max) / 2)
}

type Padding = {
  padding?: unknown
  paddingHorizontal?: unknown
  paddingLeft?: unknown
  paddingRight?: unknown
  paddingStart?: unknown
  paddingEnd?: unknown
}

const points = (...values: unknown[]) => {
  const found = values.find((value) => value !== undefined && value !== null)
  return typeof found === 'number' ? found : 0
}

/**
 * A flattened content style's side padding, each side widened by `gutter`. Both sides are written explicitly, so they win
 * over the `padding` and `paddingHorizontal` shorthands; a style that names `paddingStart` or `paddingEnd` gets those too,
 * since they would otherwise take precedence.
 */
export function withGutter(
  style: Padding | null | undefined,
  gutter: number,
): { paddingLeft: number; paddingRight: number; paddingStart?: number; paddingEnd?: number } {
  const s = style ?? {}
  const left = points(s.paddingStart, s.paddingLeft, s.paddingHorizontal, s.padding) + gutter
  const right = points(s.paddingEnd, s.paddingRight, s.paddingHorizontal, s.padding) + gutter
  return {
    paddingLeft: left,
    paddingRight: right,
    ...(s.paddingStart !== undefined ? { paddingStart: left } : {}),
    ...(s.paddingEnd !== undefined ? { paddingEnd: right } : {}),
  }
}
