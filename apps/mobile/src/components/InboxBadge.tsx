import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { useAutomation } from '../runtime/automation'
import { useStore } from '../runtime/store'
import { readPushes } from '../runtime/pushTarget'

/**
 * Puts what needs you on the app icon, as on the Inbox tab, and takes pushes out of the notification list once their
 * notice is read here or on the desktop. Not available in Expo Go or on the web, and harmless without permission.
 */
export function InboxBadge() {
  const { inbox } = useAutomation()
  const notices = useStore().inbox
  const count = inbox.needsYou
  const listed = useRef(new Map<string, Set<string>>())
  useEffect(() => {
    if (Platform.OS === 'web' || Constants.appOwnership === 'expo') return
    void import('expo-notifications').then((notifications) => notifications.setBadgeCountAsync(count)).catch(() => {})
  }, [count])
  useEffect(() => {
    if (Platform.OS === 'web' || Constants.appOwnership === 'expo') return
    void import('expo-notifications')
      .then(async (notifications) => {
        const presented = await notifications.getPresentedNotificationsAsync()
        const read = readPushes(
          presented.map((entry) => ({ id: entry.request.identifier, data: entry.request.content.data })),
          listed.current,
          notices,
        )
        await Promise.all(read.map((id) => notifications.dismissNotificationAsync(id)))
      })
      .catch(() => {})
    for (const [computerId, list] of Object.entries(notices)) {
      const seen = listed.current.get(computerId) ?? new Set<string>()
      for (const notice of list) seen.add(notice.id)
      // Bounded: the oldest notices are long read.
      while (seen.size > 500) seen.delete(seen.values().next().value!)
      listed.current.set(computerId, seen)
    }
  }, [notices])
  return null
}
