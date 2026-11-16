import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { font, space, useTheme } from '../theme'
import { LIST_PANE_WIDTH } from '../runtime/splitLayout'
import { goBackOrHome } from '../runtime/navigation'
import { useSay } from '../i18n'
import { IconButton, T } from './ui'

/**
 * The list on the left of a wide window, beside the item it opened: its own header with Back to the tab it came from,
 * since the native bar would span both panes.
 */
export function ListPane({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  const { c } = useTheme()
  const say = useSay()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  return (
    <View
      style={{
        width: LIST_PANE_WIDTH,
        borderRightWidth: StyleSheet.hairlineWidth,
        borderRightColor: c.lineStrong,
        backgroundColor: c.window,
      }}
    >
      <View
        style={{
          paddingTop: insets.top + space.s,
          paddingBottom: space.s,
          paddingLeft: Math.max(space.s, insets.left),
          paddingRight: space.s,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.xs,
          minHeight: insets.top + 56 + space.s * 2,
        }}
      >
        <IconButton icon={ChevronLeft} label={say('Back')} tone="text" onPress={() => goBackOrHome(router)} />
        <T size={font.heading} weight="700" numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">
          {title}
        </T>
        {right}
      </View>
      {children}
    </View>
  )
}
