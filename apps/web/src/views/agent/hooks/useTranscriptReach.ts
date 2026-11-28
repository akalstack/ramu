import { useCallback, useState } from 'react'

/** Frames to wait for the list to draw every row; it draws them over a frame or two. */
const DRAW_FRAMES = 30

export type TranscriptReach = (request: {
  /** Looks for the target among the rows in the page. */
  find: () => HTMLElement | null
  /** Shows the target; what it returns runs when the request is cancelled. */
  reveal: (target: HTMLElement) => void | (() => void)
  /** The target is in no row the transcript has. */
  missing?: () => void
  /** Draws every row before looking, for a target the rows on screen could also match. */
  everywhere?: boolean
}) => () => void

/**
 * Reaching something in the transcript, which keeps only the rows near the view in the page: a target that is not
 * there is looked for again once every row is drawn, and the row it is in then stays drawn, so it is still there when
 * the scroll to it lands. Returns the request and what the list should draw for it.
 */
export function useTranscriptReach() {
  const [drawing, setDrawing] = useState(0)
  const [pinned, setPinned] = useState<string | null>(null)
  const reach = useCallback<TranscriptReach>(({ find, reveal, missing, everywhere }) => {
    let cancelled = false
    let frame = 0
    let undo: (() => void) | undefined
    let drawingAll = false
    const stopDrawing = () => {
      if (drawingAll) setDrawing((count) => count - 1)
      drawingAll = false
    }
    const show = (target: HTMLElement) => {
      setPinned(target.closest<HTMLElement>('[data-transcript-row]')?.dataset.transcriptRow ?? null)
      const cleanup = reveal(target)
      if (cleanup) undo = cleanup
    }
    const found = everywhere ? null : find()
    if (found) show(found)
    else {
      drawingAll = true
      setDrawing((count) => count + 1)
      const attempt = (left: number) => {
        if (cancelled) return
        const target = find()
        // One more frame once it is there, so the rows around it have their real heights before the scroll is aimed.
        if (target)
          frame = requestAnimationFrame(() => {
            show(target)
            stopDrawing()
          })
        else if (left > 1) frame = requestAnimationFrame(() => attempt(left - 1))
        else {
          stopDrawing()
          missing?.()
        }
      }
      frame = requestAnimationFrame(() => attempt(DRAW_FRAMES))
    }
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      stopDrawing()
      undo?.()
    }
  }, [])
  return { reach, everything: drawing > 0, pinned }
}
