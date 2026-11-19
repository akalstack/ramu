import { useLanguage } from '../../../i18n'
import { onWorkspaceVisibility, workspaceVisible } from '../../../workspace/workspaceLifetime'
import { useEffect, useState } from 'react'

/** Seconds since `since`, ticking once a second while `active`. */
export function useElapsed(since: number | undefined, active: boolean): number | null {
  useLanguage()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    const sync = () => {
      clearInterval(timer)
      if (!active || document.visibilityState !== 'visible' || !workspaceVisible()) return
      setNow(Date.now())
      timer = setInterval(() => setNow(Date.now()), 1000)
    }
    sync()
    const off = onWorkspaceVisibility(sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      clearInterval(timer)
      off()
      document.removeEventListener('visibilitychange', sync)
    }
  }, [active, since])
  return since && active ? Math.max(0, now - since) : null
}
