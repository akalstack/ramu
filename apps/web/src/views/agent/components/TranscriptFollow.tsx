import { useLayoutEffect, useRef, type RefObject } from 'react'
import { useMessageScroller, useMessageScrollerScrollable } from '@/components/ui/message-scroller'
import { gestured, newFollowIntent, pressed, scrolled } from '../lib/followIntent'

const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

/**
 * Keeps the transcript following the latest output until the reader lets go of it. The scroller stops following on
 * any upward move away from the end, including ones the browser makes while rows fold and new ones arrive; when it
 * does so without the reader's doing, this returns it to the end.
 */
export function TranscriptFollow({ viewport }: { viewport: RefObject<HTMLDivElement | null> }) {
  const { scrollToEnd } = useMessageScroller()
  const { end } = useMessageScrollerScrollable()
  const intent = useRef(newFollowIntent())

  // Heard on the way down from the document, so the reader's part is known before the scroller reports the move.
  // The listeners sit on the document, so they are attached at once; the transcript is looked up when each event
  // arrives. It is not there yet when a thread opens, and listening only once it existed left the wheel unheard: every
  // turn of it then looked like the browser's own move and was undone, so the transcript could not be scrolled.
  useLayoutEffect(() => {
    const state = intent.current
    if (viewport.current) state.lastTop = viewport.current.scrollTop
    const inside = (event: Event) =>
      event.target instanceof Node && !!viewport.current && viewport.current.contains(event.target)
    const onWheel = (event: WheelEvent) => {
      if (inside(event) && !event.ctrlKey) gestured(state, { kind: 'wheel', deltaY: event.deltaY })
    }
    const onTouch = (event: Event) => {
      if (inside(event)) gestured(state, { kind: 'touch' })
    }
    const onScroll = (event: Event) => {
      const el = viewport.current
      if (!el || event.target !== el) return
      scrolled(state, el.scrollTop, el.scrollHeight - el.scrollTop - el.clientHeight, performance.now())
    }
    const onDown = () => pressed(state, performance.now(), 'down')
    const onUp = () => pressed(state, performance.now(), 'up')
    const onKey = (event: KeyboardEvent) => {
      if (!editable(event.target)) pressed(state, performance.now())
    }
    const listen = { capture: true, passive: true }
    document.addEventListener('wheel', onWheel, listen)
    document.addEventListener('touchmove', onTouch, listen)
    document.addEventListener('scroll', onScroll, listen)
    window.addEventListener('pointerdown', onDown, listen)
    window.addEventListener('pointerup', onUp, listen)
    window.addEventListener('pointercancel', onUp, listen)
    document.addEventListener('keydown', onKey, listen)
    return () => {
      document.removeEventListener('wheel', onWheel, listen)
      document.removeEventListener('touchmove', onTouch, listen)
      document.removeEventListener('scroll', onScroll, listen)
      window.removeEventListener('pointerdown', onDown, listen)
      window.removeEventListener('pointerup', onUp, listen)
      window.removeEventListener('pointercancel', onUp, listen)
      document.removeEventListener('keydown', onKey, listen)
    }
  }, [viewport])

  // `end` turns true only once the scroller has stopped following and the view is away from the end.
  useLayoutEffect(() => {
    if (!end) intent.current.released = false
    else if (!intent.current.released) scrollToEnd({ behavior: 'auto' })
  }, [end, scrollToEnd])
  return null
}
