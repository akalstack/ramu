import { useEffect, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'
import Constants from 'expo-constants'

/** How often the host hears again that a thread is still in front; it stops counting one it has not heard about. */
const REPEAT_MS = 60_000

/**
 * Tells the thread's host that the person is looking at it, while this screen is in front and Ramu is open, so the
 * host sends no push about it; and takes that thread's pushes already in the notification list away, as read.
 */
export function useThreadViewing(
  invoke: (computerId: string, method: 'notifications.viewing', sessionIds: string[]) => Promise<unknown>,
  computerId: string | undefined,
  sessionId: string | null | undefined,
  focused: boolean,
) {
  // The store's invoke is a new function on each render; the effect below must run only when what is viewed changes.
  const call = useRef(invoke)
  call.current = invoke
  const [active, setActive] = useState(AppState.currentState === 'active')
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'))
    return () => subscription.remove()
  }, [])
  const viewing = focused && active && !!computerId && !!sessionId
  useEffect(() => {
    if (!viewing || !computerId || !sessionId) return
    const tell = () => void call.current(computerId, 'notifications.viewing', [sessionId]).catch(() => {})
    tell()
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
      void call.current(computerId, 'notifications.viewing', []).catch(() => {})
    }
  }, [viewing, computerId, sessionId])
}
