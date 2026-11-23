import { useLayoutEffect, useRef, useState } from 'react'
import { HOLD_PAUSE_MS, NO_HOLD, holdHeight, releaseHold, type HeightHold } from '@ramu/shared/chat/heldHeight'

/**
 * Keeps a live tool group at the tallest height it has reached (`holdHeight`), so the transcript does not jump up and
 * down as lines come and go inside it while the turn runs. It writes `min-height` straight to the element, so a
 * streaming turn never re-renders for it. `release` is for the person's own clicks inside the group: the hold lets go
 * so what they open or fold shows, and picks up again once the motion has settled. `identity` names the group (its first
 * call), so a different group drawn in the same place never starts from the height the last one reached.
 */
export function useHeldHeight<T extends HTMLElement>(live: boolean, identity: string | undefined) {
  const ref = useRef<T>(null)
  const hold = useRef<HeightHold>(NO_HOLD)
  const liveNow = useRef(live)
  const pause = useRef<ReturnType<typeof setTimeout>>(undefined)
  const held = useRef(identity)
  // One function for the component's life, so the observer and the effects below keep the same one.
  const [measure] = useState(() => () => {
    const el = ref.current
    if (!el) return
    const next = holdHeight(hold.current, el.offsetHeight, liveNow.current, Date.now())
    if (next === hold.current) return
    hold.current = next
    el.style.minHeight = next.min ? `${next.min}px` : ''
  })
  useLayoutEffect(() => {
    liveNow.current = live
    if (held.current !== identity) {
      held.current = identity
      hold.current = NO_HOLD
      if (ref.current) ref.current.style.minHeight = ''
    }
    measure()
  }, [live, identity, measure])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => {
      observer.disconnect()
      clearTimeout(pause.current)
    }
  }, [measure])
  const release = () => {
    const el = ref.current
    if (!el) return
    hold.current = releaseHold(Date.now())
    el.style.minHeight = ''
    clearTimeout(pause.current)
    pause.current = setTimeout(measure, HOLD_PAUSE_MS)
  }
  return { ref, release }
}
