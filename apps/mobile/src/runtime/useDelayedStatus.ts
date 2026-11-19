import { useEffect, useState } from 'react'
import {
  delayedStatusDeadline,
  shownDelayedStatus,
  stepDelayedStatus,
  type DelayedStatus,
} from '@ramu/shared/chat/delayedStatus'

/** `value` once it has stayed set for a moment, held briefly after it clears; see `stepDelayedStatus`. */
export function useDelayedStatus<A>(key: string, value: A | null): A | null {
  const [state, setState] = useState<DelayedStatus<A>>(() => ({ phase: 'idle', key }))
  const [wake, setWake] = useState(0)
  useEffect(() => setState((current) => stepDelayedStatus(current, key, value, Date.now())), [key, value, wake])
  const deadline = delayedStatusDeadline(state)
  useEffect(() => {
    if (deadline === null) return
    const timer = setTimeout(() => setWake((n) => n + 1), Math.max(0, deadline - Date.now()))
    return () => clearTimeout(timer)
  }, [deadline])
  return state.key === key ? shownDelayedStatus(state) : null
}
