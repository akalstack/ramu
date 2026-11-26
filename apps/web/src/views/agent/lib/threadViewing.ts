import { useEffect } from 'react'
import { invokerFor } from '../../../ipc'

/** How often a host hears again that its threads are still in front; it stops counting ones it has not heard about. */
const REPEAT_MS = 60_000

// The threads on screen per host, counted, since a thread can show in more than one pane.
const shown = new Map<string, Map<string, number>>()
let timer: ReturnType<typeof setInterval> | null = null

/** Only a window the person is looking at counts: visible and focused. */
const inFront = () => document.visibilityState === 'visible' && document.hasFocus()

function tell(host: string) {
  const sessions = shown.get(host)
  const ids = inFront() && sessions ? [...sessions.keys()].slice(0, 20) : []
  void invokerFor(host)('notifications.viewing', ids).catch(() => {})
}
const tellAll = () => {
  for (const host of shown.keys()) tell(host)
}

function track() {
  if (timer) return
  timer = setInterval(() => {
    if (inFront()) tellAll()
  }, REPEAT_MS)
  window.addEventListener('focus', tellAll)
  window.addEventListener('blur', tellAll)
  document.addEventListener('visibilitychange', tellAll)
}
function untrack() {
  if (!timer || shown.size) return
  clearInterval(timer)
  timer = null
  window.removeEventListener('focus', tellAll)
  window.removeEventListener('blur', tellAll)
  document.removeEventListener('visibilitychange', tellAll)
}

/**
 * Tells the thread's host that the person is looking at it while it is on screen in a focused window, so the host sends
 * the phone no push about it.
 */
export function useThreadViewing(host: string, sessionId: string, visible: boolean) {
  useEffect(() => {
    if (!visible || !sessionId) return
    const sessions = shown.get(host) ?? new Map<string, number>()
    shown.set(host, sessions)
    sessions.set(sessionId, (sessions.get(sessionId) ?? 0) + 1)
    track()
    tell(host)
    return () => {
      const left = (sessions.get(sessionId) ?? 1) - 1
      if (left) sessions.set(sessionId, left)
      else sessions.delete(sessionId)
      tell(host)
      if (!sessions.size) shown.delete(host)
      untrack()
    }
  }, [host, sessionId, visible])
}
