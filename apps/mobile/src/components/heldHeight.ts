import { useEffect, useRef, useState } from 'react'
import type { LayoutChangeEvent } from 'react-native'
import { HOLD_PAUSE_MS, NO_HOLD, holdHeight, releaseHold } from '@ramu/shared/chat/heldHeight'

/**
 * Keeps a live tool group at the tallest height it has reached (`holdHeight`), as the desktop's does, so the chat does
 * not jump up and down as lines come and go inside it while the turn runs. Spread `minHeight` and `onLayout` on the
 * group's outer view; call `release` when the person opens or folds something in it, so their fold shows. `identity`
 * names the group (its first item), so a different group drawn in the same row never starts from the last one's height.
 */
export function useHeldHeight(live: boolean, identity: string) {
  const [hold, setHold] = useState(NO_HOLD)
  const height = useRef(0)
  const liveNow = useRef(live)
  const pause = useRef<ReturnType<typeof setTimeout>>(undefined)
  const held = useRef(identity)
  // Stable for the component's life, so the rows given `release` do not redraw for it.
  const [actions] = useState(() => {
    const measure = () => setHold((current) => holdHeight(current, height.current, liveNow.current, Date.now()))
    return {
      measure,
      onLayout: (event: LayoutChangeEvent) => {
        height.current = event.nativeEvent.layout.height
        measure()
      },
      release: () => {
        setHold(releaseHold(Date.now()))
        clearTimeout(pause.current)
        pause.current = setTimeout(measure, HOLD_PAUSE_MS)
      },
    }
  })
  useEffect(() => {
    liveNow.current = live
    if (held.current !== identity) {
      held.current = identity
      // The last layout was the old group's; the new one's arrives once its own height is drawn.
      height.current = 0
      setHold(NO_HOLD)
    }
    actions.measure()
  }, [live, identity, actions])
  useEffect(() => () => clearTimeout(pause.current), [])
  return { minHeight: hold.min || undefined, onLayout: actions.onLayout, release: actions.release }
}
