import { useLanguage } from '../../../i18n'
import { useEffect, useState } from 'react'

/** Seconds since `since`, ticking once a second while `active`. */
export function useElapsed(since: number | undefined, active: boolean): number | null {
  useLanguage()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return since && active ? Math.max(0, now - since) : null
}
