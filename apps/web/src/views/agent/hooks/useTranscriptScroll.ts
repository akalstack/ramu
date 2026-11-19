import { useLayoutEffect, useRef, type RefObject, type UIEvent } from 'react'
import { NEAR_BOTTOM_PX } from '../constants'

/**
 * Asks the transcript's MessageScroller to stop following new output, as a wheel gesture does. Use it after moving
 * the viewport on the reader's behalf (restoring a saved position), which the scroller cannot tell from its own jumps.
 */
export function releaseFollow(viewport: HTMLElement | null) {
  viewport?.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
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

  // Match the transcript's usable width, including non-overlay OS scrollbars.
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

  return { scroller, stick, onScroll }
}
