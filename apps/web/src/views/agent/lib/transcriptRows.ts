import type { ReactNode } from 'react'

/** One row of the transcript list. Keys start with the row's kind and a colon (`turn:12`, `steering:<id>`). */
export type TranscriptRow = { key: string; render: () => ReactNode }

/** The row at the top of the view and how far it is scrolled past, so a reopened thread shows the same lines. */
export type TranscriptAnchor = { key: string; offset: number }

export const TURN_ROW = 'turn:'

/** Where a transcript opens: at its end, or at the row the reader left it on. */
export type TranscriptOpening = { end: true } | { end: false; index: number; viewOffset: number }

/**
 * A thread left at the end, or never opened, opens at the end. One left higher up opens on the row it was left on.
 * When that row is an earlier turn the page no longer draws, the earliest drawn turn is the nearest place to it; any
 * other row that is gone was a message on its way, near the end.
 */
export function transcriptOpening(
  rows: readonly { key: string }[],
  left: { stick: boolean; anchor?: TranscriptAnchor } | undefined,
): TranscriptOpening {
  if (!left || left.stick || !left.anchor) return { end: true }
  const { key, offset } = left.anchor
  const index = rows.findIndex((row) => row.key === key)
  if (index >= 0) return { end: false, index, viewOffset: -offset }
  return key.startsWith(TURN_ROW) ? { end: false, index: 0, viewOffset: 0 } : { end: true }
}
