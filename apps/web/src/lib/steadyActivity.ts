import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Long enough to cover the gap between a turn's steps, short enough that a finished thread still settles promptly. */
const HOLD_MS = 1500

/** True while `active`, and briefly after: a turn's momentary stops should not read as stopping and starting. */
export function useHeld(active: boolean): boolean {
  const [held, setHeld] = useState(active)
  useEffect(() => {
    if (active) {
      setHeld(true)
      return
    }
    const timer = window.setTimeout(() => setHeld(false), HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [active])
  return active || held
}

/**
 * Keeps a CSS spinner on one shared clock. A list that re-sorts moves its row in the DOM, which restarts the animation
 * and reads as a blink; pinned to the timeline, every spinner stays in phase however often it moves or remounts.
 */
export function useSteadySpin<T extends Element>() {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    for (const animation of ref.current?.getAnimations?.({ subtree: true }) ?? []) animation.startTime = 0
  })
  return ref
}
