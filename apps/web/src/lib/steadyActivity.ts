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

const PULSE: Keyframe[] = [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }]

/**
 * Breathes the element's dot (its ::before) on one shared clock, so every working dot on screen pulses together. A CSS
 * animation restarts whenever a re-sorting list moves its row, without the row rendering again; an animation started
 * from script stays with the element and is pinned to the document's clock.
 */
export function useSteadyPulse<T extends Element>() {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element?.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const animation = element.animate(PULSE, {
      duration: 1600,
      easing: 'ease-in-out',
      iterations: Infinity,
      pseudoElement: '::before',
    })
    animation.startTime = 0
    return () => animation.cancel()
  }, [])
  return ref
}
