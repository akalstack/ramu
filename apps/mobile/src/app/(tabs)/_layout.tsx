import { Platform } from 'react-native'
import { NativeTabs } from 'expo-router/native-tabs'
import { useTheme } from '../../theme'
import { useAutomation } from '../../runtime/automation'
import { usePullRequestsWaiting } from '../../runtime/pullRequestsWaiting'
import { useSay, useT } from '../../i18n'

// The app's places, as a native tab bar (Liquid Glass on iOS 26): Threads, Inbox, Pull requests, Artifacts and, on iOS,
// New thread. Schedules open from the Inbox, where their results arrive.
// Each tab holds its own stack, so a thread opened from any of them pushes on the root stack above the bar.
export default function TabsLayout() {
  const { c, scheme } = useTheme()
  const t = useT()
  const say = useSay()
  const { inbox } = useAutomation()
  const pullsWaiting = usePullRequestsWaiting()
  // iOS keeps UIKit's own (Liquid Glass) bar. Android gets the Material 3 navigation bar, coloured from our palette.
  const material =
    Platform.OS === 'android'
      ? {
          backgroundColor: c.raised2,
          labelVisibilityMode: 'labeled' as const,
          indicatorColor: scheme === 'dark' ? '#40376b' : '#e4dbff',
          // Material 3's pressed state layer (the text color at about 10%), not the platform's darker default.
          rippleColor: c.pressed,
          iconColor: { default: c.muted, selected: c.text },
          labelStyle: { default: { color: c.muted }, selected: { color: c.text } },
          badgeBackgroundColor: c.bad,
          badgeTextColor: '#ffffff',
        }
      : {}
  return (
    // On iPad the bar can become UIKit's sidebar (iPadOS 18+), so a wide screen gets the side navigation iPad apps use.
    <NativeTabs tintColor={c.accent} minimizeBehavior="onScrollDown" sidebarAdaptable {...material}>
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
      <NativeTabs.Trigger name="pulls">
        <NativeTabs.Trigger.Icon sf={{ default: 'arrow.triangle.pull', selected: 'arrow.triangle.pull' }} md="merge" />
        <NativeTabs.Trigger.Label>{say('Pull requests')}</NativeTabs.Trigger.Label>
        {pullsWaiting > 0 ? <NativeTabs.Trigger.Badge>{String(pullsWaiting)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="artifacts">
        <NativeTabs.Trigger.Icon sf={{ default: 'macwindow', selected: 'macwindow' }} md="web" />
        <NativeTabs.Trigger.Label>{say('Artifacts')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      {/* Android starts a thread from the Threads list's floating button, as Material apps do. */}
      <NativeTabs.Trigger name="compose" prominent hidden={Platform.OS === 'android'}>
        <NativeTabs.Trigger.Icon sf="square.and.pencil" md="edit_square" />
        <NativeTabs.Trigger.Label>{t.newChat}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
