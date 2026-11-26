import { useEffect } from 'react'
import { invokerFor } from '../../../ipc'

/** How often a host hears again that its threads are still in front; it stops counting ones it has not heard about. */
const REPEAT_MS = 60_000

// The threads on screen per host, counted, since a thread can show in more than one pane.
const shown = new Map<string, Map<string, number>>()
let timer: ReturnType<typeof setInterval> | null = null

/** Only a window the person is looking at counts: visible and focused. */
const inFront = () => document.visibilityState === 'visible' && document.hasFocus()

/** How long after the last key or pointer the person still counts as at the desktop. */
const PRESENT_MS = 120_000
/** The hosts this window is connected to: each hears whether the person is using the app, whatever is on screen. */
let hosts: readonly string[] = []
let lastInput = 0
const noteInput = () => {
  const away = !present()
  lastInput = Date.now()
  // Back after a while away: say so now instead of at the next repeat.
  if (away && inFront()) tellAll()
}
/**
 * The person is using this app right now: the window is in front and they touched it lately. What happens in any
 * thread then shows here, in the app's own notifications, so the host sends the phone nothing; a focused window nobody
 * is at stops counting, and the phone hears again.
 */
const present = () => inFront() && Date.now() - lastInput < PRESENT_MS

function tell(host: string) {
  const sessions = shown.get(host)
  const ids = inFront() && sessions ? [...sessions.keys()].slice(0, 20) : []
  void invokerFor(host)('notifications.viewing', ids, present()).catch(() => {})
}
const tellAll = () => {
  for (const host of new Set([...shown.keys(), ...hosts])) tell(host)
}

const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const
function track() {
  if (timer) return
  timer = setInterval(() => {
    if (inFront()) tellAll()
  }, REPEAT_MS)
  window.addEventListener('focus', tellAll)
  window.addEventListener('blur', tellAll)
  document.addEventListener('visibilitychange', tellAll)
  for (const event of INPUT_EVENTS) window.addEventListener(event, noteInput, { passive: true, capture: true })
}
function untrack() {
  if (!timer || shown.size || hosts.length) return
  clearInterval(timer)
  timer = null
  window.removeEventListener('focus', tellAll)
  window.removeEventListener('blur', tellAll)
  document.removeEventListener('visibilitychange', tellAll)
  for (const event of INPUT_EVENTS) window.removeEventListener(event, noteInput, { capture: true })
}

/**
 * Tells every connected host whether the person is using this app, so a host sends the phone no push while what
 * happens shows here. Mounted once, for the window.
 */
export function useDesktopPresence(connected: readonly string[]) {
  const key = connected.join('\n')
  useEffect(() => {
    hosts = key ? key.split('\n') : []
    track()
    tellAll()
    return () => {
      const left = hosts
      hosts = []
      for (const host of left) tell(host)
      untrack()
    }
  }, [key])
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
