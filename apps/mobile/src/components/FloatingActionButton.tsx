import { Platform, Pressable } from 'react-native'
import Reanimated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { space, useTheme } from '../theme'
import { tap, type Icon } from './ui'

// Material 3 Expressive's FAB: 56 dp with 16 dp corners at rest; under a finger its shape morphs rounder and it settles
// smaller on a fast spatial spring, then springs back.
const SIZE = 56
const REST = 16
const PRESSED = 28
const SPRING = { damping: 14, stiffness: 520, mass: 1 }

/**
 * A screen's main way to make something, as Material 3's FAB on Android: an icon at the bottom end of the screen, with
 * the label as its accessible name. iOS keeps the action in its tab bar or navigation bar, so this draws nothing there.
 */
export function FloatingActionButton({
  icon: I,
  label,
  onPress,
  overSystemBar = false,
}: {
  icon: Icon
  label: string
  onPress(): void
  /** On a screen without the tab bar, so it keeps clear of the gesture or button navigation bar. */
  overSystemBar?: boolean
}) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const pressed = useSharedValue(0)
  const shape = useAnimatedStyle(() => ({
    borderRadius: REST + (PRESSED - REST) * pressed.value,
    transform: [{ scale: 1 - 0.06 * pressed.value }],
  }))
  if (Platform.OS !== 'android') return null
  return (
    <Reanimated.View
      style={[
        {
          position: 'absolute',
          right: space.l,
          bottom: space.l + (overSystemBar ? insets.bottom : 0),
          width: SIZE,
          height: SIZE,
          overflow: 'hidden',
          backgroundColor: c.primary,
          elevation: 6,
        },
        shape,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPressIn={() => (pressed.value = withSpring(1, SPRING))}
        onPressOut={() => (pressed.value = withSpring(0, SPRING))}
        onPress={() => {
          tap()
          onPress()
        }}
        android_ripple={{ color: 'rgba(255,255,255,0.24)', borderless: false }}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
      >
        <I size={24} color={c.primaryInk} strokeWidth={2} />
      </Pressable>
    </Reanimated.View>
  )
}
