import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { TranscriptAnchor } from '../lib/transcriptRows'

/**
 * Asks the transcript to stop following new output, as a wheel gesture does. Use it when moving the viewport on the
 * reader's behalf (showing a found message), which nothing can tell from a move the browser made by itself.
 */
export function releaseFollow(viewport: HTMLElement | null) {
  // Upward, so it reads as the reader's own to whatever keeps the transcript following.
  viewport?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -1 }))
}

/**
 * What the chat view keeps of the transcript's scroll viewport: the element (the list draws it, and draws a new one for
 * each thread), whether the reader is near the bottom and the row they are reading (so a chat can be reopened as it was
 * left), and the scrollbar width the layout needs.
 */
export function useTranscriptScroll({
  root,
  chat,
  saved,
}: {
  root: RefObject<HTMLDivElement | null>
  /** Which thread is shown; another one starts from where it was left. */
  chat: string
  saved: { stick: boolean; anchor?: TranscriptAnchor } | undefined
}) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const stick = useRef(saved?.stick ?? true)
  const anchor = useRef(saved?.anchor)
  // After the previous thread's position was remembered on the way out (useChatPresentation).
  useLayoutEffect(() => {
    stick.current = saved?.stick ?? true
    anchor.current = saved?.anchor
  }, [chat, saved])
  const attach = useCallback((element: HTMLDivElement | null) => {
    scroller.current = element
    setViewport(element)
  }, [])

  // Native scrollbars are hidden, so this measures 0; a scroller that does take width still lines the composer up.
  useLayoutEffect(() => {
    const el = viewport
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
  }, [viewport, root])

  // The tray above the composer (servers, terminals, agents, goal) comes and goes below the transcript. Its height is
  // taken from the transcript's bottom edge, so the scroll moves by the same amount before the frame paints: the lines
  // next to the composer stay where they are, and showing then hiding the tray lands exactly where the reader was.
  useLayoutEffect(() => {
    const el = viewport
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
  }, [viewport])

  return { scroller, attach, stick, anchor }
}
