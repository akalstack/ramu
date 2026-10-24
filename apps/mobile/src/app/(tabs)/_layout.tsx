import { Platform } from 'react-native'
import { NativeTabs } from 'expo-router/native-tabs'
import { useTheme } from '../../theme'
import { useAutomation } from '../../runtime/automation'
import { useT } from '../../i18n'

// The app's four places, as a native tab bar (Liquid Glass on iOS 26): Threads, Inbox, Schedules and Search.
// Each tab holds its own stack, so a thread opened from any of them pushes on the root stack above the bar.
export default function TabsLayout() {
  const { c, scheme } = useTheme()
  const t = useT()
  const { inbox } = useAutomation()
  // iOS keeps UIKit's own (Liquid Glass) bar. Android gets the Material 3 navigation bar, coloured from our palette.
  const material =
    Platform.OS === 'android'
      ? {
          backgroundColor: c.raised2,
          labelVisibilityMode: 'labeled' as const,
          indicatorColor: scheme === 'dark' ? '#40376b' : '#e4dbff',
          iconColor: { default: c.muted, selected: c.text },
          labelStyle: { default: { color: c.muted }, selected: { color: c.text } },
          badgeBackgroundColor: c.bad,
          badgeTextColor: '#ffffff',
        }
      : {}
  return (
    <NativeTabs tintColor={c.accent} minimizeBehavior="onScrollDown" {...material}>
      <NativeTabs.Trigger name="(threads)">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }}
          md="forum"
        />
        <NativeTabs.Trigger.Label>{t.chats}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="inbox">
        <NativeTabs.Trigger.Icon sf={{ default: 'tray', selected: 'tray.fill' }} md="inbox" />
        <NativeTabs.Trigger.Label>{t.inbox}</NativeTabs.Trigger.Label>
        {inbox.needsYou > 0 ? <NativeTabs.Trigger.Badge>{String(inbox.needsYou)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="schedules">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'calendar.badge.clock', selected: 'calendar.badge.clock' }}
          md="schedule"
        />
        <NativeTabs.Trigger.Label>{t.schedules}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search" role="search">
        <NativeTabs.Trigger.Icon md="search" />
        <NativeTabs.Trigger.Label>{t.searchTab}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
