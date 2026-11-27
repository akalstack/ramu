import { useEffect, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'
import Constants from 'expo-constants'

/** How often the host hears again that a thread is still in front; it stops counting one it has not heard about. */
const REPEAT_MS = 60_000

type Report = (computerId: string, method: 'notifications.viewing', sessionIds: string[], present: boolean) => unknown

/** The threads on screen per host. */
const viewed = new Map<string, Set<string>>()
const viewers = new Set<() => void>()
let appActive = AppState.currentState === 'active'
/** Whether the person has this thread in front of them in Ramu right now. */
export const isThreadViewed = (computerId: string, sessionId: string) => !!viewed.get(computerId)?.has(sessionId)
/** Hears when the person opens a thread, so the finished Live Activity about it can step aside. */
export function onThreadViewed(listener: () => void) {
  viewers.add(listener)
  return () => void viewers.delete(listener)
}

/**
 * One report per host, carrying both facts the host keeps per device: the threads on screen, and whether the person is
 * using the app at all. Sent together, so a thread closing never clears the presence, nor the reverse.
 */
function report(call: Report, computerId: string) {
  const sessions = appActive ? [...(viewed.get(computerId) ?? [])].slice(0, 20) : []
  void Promise.resolve(call(computerId, 'notifications.viewing', sessions, appActive)).catch(() => {})
}

/**
 * Tells every connected host whether the person is using the app right now: open and in front. While they are, the
 * phone shows each thread's news in its own banner, so a host sends no push and a desktop raises no system
 * notification. Mounted once, for the app.
 */
export function useAppPresence(invoke: Report, computerIds: readonly string[]) {
  const call = useRef(invoke)
  call.current = invoke
  const [active, setActive] = useState(appActive)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      appActive = state === 'active'
      setActive(appActive)
    })
    return () => subscription.remove()
  }, [])
  const key = computerIds.join('\n')
  useEffect(() => {
    const hosts = key ? key.split('\n') : []
    const tellAll = () => {
      for (const host of hosts) report(call.current, host)
    }
    tellAll()
    // Gone to the background: said once just above; the hosts stop counting the phone without hearing again.
    if (!active) return
    const timer = setInterval(tellAll, REPEAT_MS)
    return () => clearInterval(timer)
  }, [key, active])
}

/**
 * Tells the thread's host that the person is looking at it, while this screen is in front and Ramu is open, so the
 * host sends no push about it; and takes that thread's pushes already in the notification list away, as read.
 */
export function useThreadViewing(
  invoke: Report,
  computerId: string | undefined,
  sessionId: string | null | undefined,
  focused: boolean,
) {
  // The store's invoke is a new function on each render; the effect below must run only when what is viewed changes.
  const call = useRef(invoke)
  call.current = invoke
  const [active, setActive] = useState(appActive)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      appActive = state === 'active'
      setActive(appActive)
    })
    return () => subscription.remove()
  }, [])
  const viewing = focused && active && !!computerId && !!sessionId
  useEffect(() => {
    if (!viewing || !computerId || !sessionId) return
    const sessions = viewed.get(computerId) ?? new Set<string>()
    viewed.set(computerId, sessions)
    sessions.add(sessionId)
    const tell = () => report(call.current, computerId)
    tell()
    for (const listener of viewers) listener()
    const timer = setInterval(tell, REPEAT_MS)
    if (Platform.OS !== 'web' && Constants.appOwnership !== 'expo')
      void import('expo-notifications')
        .then(async (notifications) => {
          const presented = await notifications.getPresentedNotificationsAsync()
          const shown = presented.filter((entry) => entry.request.content.data?.sessionId === sessionId)
          await Promise.all(shown.map((entry) => notifications.dismissNotificationAsync(entry.request.identifier)))
        })
        .catch(() => {})
    return () => {
      clearInterval(timer)
      sessions.delete(sessionId)
      if (!sessions.size) viewed.delete(computerId)
      tell()
    }
  }, [viewing, computerId, sessionId])
}
