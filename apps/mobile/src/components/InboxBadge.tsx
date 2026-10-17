import { useEffect } from 'react'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { useAutomation } from '../runtime/automation'

/** Puts what needs you on the app icon, as on the Inbox tab. Not available in Expo Go or on the web, and harmless without permission. */
export function InboxBadge() {
  const { inbox } = useAutomation()
  const count = inbox.needsYou
  useEffect(() => {
    if (Platform.OS === 'web' || Constants.appOwnership === 'expo') return
    void import('expo-notifications').then((notifications) => notifications.setBadgeCountAsync(count)).catch(() => {})
  }, [count])
  return null
}
