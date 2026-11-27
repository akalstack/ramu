import { useLayoutEffect, useRef, type RefObject, type UIEvent } from 'react'
import { NEAR_BOTTOM_PX } from '../constants'

/**
 * Asks the transcript's MessageScroller to stop following new output, as a wheel gesture does. Use it when moving
 * the viewport on the reader's behalf (restoring a saved position, showing a found message), which nothing can tell
 * from a move the browser made by itself.
 */
export function releaseFollow(viewport: HTMLElement | null) {
  // Upward, so it also reads as the reader's own to whatever keeps the transcript following.
  viewport?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -1 }))
}

/**
 * What the chat view needs from the transcript's scroll viewport beyond the shadcn MessageScroller (which follows new
 * output and holds position on prepend): the viewport element, whether the reader is at the bottom (so a chat can be
 * reopened as it was left) and the scrollbar width the layout needs.
 */
export function useTranscriptScroll({
  root,
  savedStick,
}: {
  root: RefObject<HTMLDivElement | null>
  savedStick: boolean | undefined
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(savedStick ?? true)
  /** Scroll handler for the transcript viewport. */
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
  }

  // Native scrollbars are hidden, so this measures 0; a scroller that does take width still lines the composer up.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    let previousWidth = -1
    const measure = () => {
      // Measuring the transcript forces layout. Defer this stable scrollbar
      // gutter until release instead of doing it for every live drag frame.
      if (
        document.querySelector('[data-separator="active"], [data-workspace-split][data-dragging], [data-rail-dragging]')
      )
        return
      const width = el.offsetWidth - el.clientWidth
      if (width === previousWidth) return
      previousWidth = width
      root.current?.style.setProperty('--chat-scrollbar-width', `${width}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    const release = new MutationObserver(measure)
    release.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-separator', 'data-dragging', 'data-rail-dragging'],
    })
    return () => {
      observer.disconnect()
      release.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [mount only] by design; the values it reads beyond these are current as of that run
  }, [])

  // The tray above the composer (servers, terminals, agents, goal) comes and goes below the transcript. Its height is
  // taken from the transcript's bottom edge, so the scroll moves by the same amount before the frame paints: the lines
  // next to the composer stay where they are, and showing then hiding the tray lands exactly where the reader was.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    let previousHeight = el.clientHeight
    const observer = new ResizeObserver(() => {
      const height = el.clientHeight
      const change = previousHeight - height
      // A hidden view measures 0; it reopens where it was rather than shifting by its whole height.
      if (change && previousHeight && height) el.scrollTop += change
      previousHeight = height
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { scroller, stick, onScroll }
}
