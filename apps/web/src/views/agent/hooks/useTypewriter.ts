import { useLanguage } from '../../../i18n'
import { useEffect, useRef, useState } from 'react'
import { useAppSettings } from '../../../settings/AppSettings'
import { reducedMotion } from '../../../workspace/panelMotion'

/** Reveals streamed text at a steady pace instead of in the bursts the provider sends it, catching up faster the further behind it is. */
export function useTypewriter(text: string, active: boolean): string {
  useLanguage()
  const { preferences } = useAppSettings()
  active = active && !preferences.reduceMotion && !reducedMotion()
  const [shown, setShown] = useState(active ? 0 : text.length)
  const target = useRef(text.length)
  target.current = text.length
  useEffect(() => {
    if (!active) {
      setShown(text.length)
      return
    }
    const timer = setInterval(
      () =>
        setShown((current) => {
          const remaining = target.current - current
          if (remaining <= 0) return Math.min(current, target.current)
          return current + Math.max(2, Math.ceil(remaining * 0.12))
        }),
      32,
    )
    return () => clearInterval(timer)
  }, [active])
  if (!active || shown >= text.length) return text
  // Words appear whole: extend the cut to the next space.
  const next = text.slice(shown).search(/\s/)
  return text.slice(0, next === -1 ? text.length : shown + next)
}
