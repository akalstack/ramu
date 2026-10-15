import { useEffect, useLayoutEffect, useRef, useState, type RefObject, type UIEvent } from 'react'
import type { AgentSessionState } from '@ramu/shared/types'
import { reducedMotion } from '../../../panelMotion'
import { NEAR_BOTTOM_PX } from '../constants'

/**
 * Scrolling for a chat transcript: whether it follows new output, the fade at its edges, an eased jump to the
 * latest message and the scrollbar width the layout needs. `followOn` lists what should make it re-follow.
 */
export function useTranscriptScroll({
  root,
  savedStick,
  followOn,
}: {
  root: RefObject<HTMLDivElement | null>
  savedStick: boolean | undefined
  followOn: { events: unknown; state: AgentSessionState | undefined; reviews: unknown }
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(savedStick ?? true)
  const scrollFrame = useRef(0)
  // Eases to the bottom over a fixed, short time (the browser's own smooth scroll is slow and uneven over long distances); a wheel or touch stops it.
  const scrollToLatest = () => {
    const el = scroller.current
    if (!el) return
    cancelAnimationFrame(scrollFrame.current)
    if (reducedMotion()) {
      el.scrollTop = el.scrollHeight
      stick.current = true
      return
    }
    const from = el.scrollTop,
      start = performance.now()
    const duration = Math.min(420, 160 + Math.abs(el.scrollHeight - el.clientHeight - from) / 12)
    const stop = () => {
      cancelAnimationFrame(scrollFrame.current)
      el.removeEventListener('wheel', stop)
      el.removeEventListener('touchstart', stop)
    }
    el.addEventListener('wheel', stop, { passive: true, once: true })
    el.addEventListener('touchstart', stop, { passive: true, once: true })
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration),
        eased = 1 - Math.pow(1 - t, 3)
      el.scrollTop = from + (el.scrollHeight - el.clientHeight - from) * eased
      if (t < 1) scrollFrame.current = requestAnimationFrame(step)
      else {
        stick.current = true
        el.removeEventListener('wheel', stop)
        el.removeEventListener('touchstart', stop)
      }
    }
    scrollFrame.current = requestAnimationFrame(step)
  }
  const [edges, setEdges] = useState({ top: false, bottom: false })
  const measureEdges = () => {
    const el = scroller.current
    if (!el) return
    const top = el.scrollTop > 2,
      bottom = el.scrollHeight - el.scrollTop - el.clientHeight > 2
    setEdges((current) => (current.top === top && current.bottom === bottom ? current : { top, bottom }))
  }
  /** Scroll handler for the transcript viewport. */
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    measureEdges()
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
  }, [])

  // Follow new output only while the reader is already at the bottom.
  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
    measureEdges()
    // Markdown, code and images settle after the first paint and grow the content; follow that growth once more.
    const frame = requestAnimationFrame(() => {
      const node = scroller.current
      if (node && stick.current) {
        node.scrollTop = node.scrollHeight
        measureEdges()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [followOn.events, followOn.state, followOn.reviews])

  return { scroller, stick, edges, measureEdges, scrollToLatest, onScroll }
}
