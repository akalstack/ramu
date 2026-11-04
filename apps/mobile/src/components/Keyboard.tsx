import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Dimensions,
  Keyboard,
  LayoutAnimation,
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { space } from '../theme'

/**
 * Keyboard height, laid out with the keyboard's own curve on iOS. Android (edge-to-edge, so the window is not resized for
 * the keyboard) only reports after the keyboard has moved, so its lift uses a short standard ease. KeyboardAvoidingView
 * only pads, so it cannot move absolutely positioned chrome (the floating composer and search bar); this can.
 *
 * It moves layout, not a native-driven transform: the New Architecture measures views without such a transform, so a
 * button lifted by one is measured where it would sit with the keyboard closed, and a tap that moves a hair is cancelled.
 */
export function useKeyboardHeight(onWillMove?: (to: number) => void) {
  const [height, setHeight] = useState(0)
  const notify = useRef(onWillMove)
  notify.current = onWillMove
  useEffect(() => {
    const move = (to: number, duration: number) => {
      // Before the state change renders, so a screen can note whether the reader was at the bottom.
      notify.current?.(to)
      LayoutAnimation.configureNext(
        Platform.OS === 'ios'
          ? { duration: duration || 250, update: { duration: duration || 250, type: LayoutAnimation.Types.keyboard } }
          : LayoutAnimation.create(220, LayoutAnimation.Types.easeOut, LayoutAnimation.Properties.opacity),
      )
      setHeight(to)
    }
    if (Platform.OS === 'android') {
      const show = Keyboard.addListener('keyboardDidShow', (e) => move(e.endCoordinates.height, 0))
      const hide = Keyboard.addListener('keyboardDidHide', () => move(0, 0))
      return () => {
        show.remove()
        hide.remove()
      }
    }
    if (Platform.OS !== 'ios') return
    const frame = Keyboard.addListener('keyboardWillChangeFrame', (e) =>
      move(Math.max(0, Dimensions.get('window').height - e.endCoordinates.screenY), e.duration),
    )
    const hide = Keyboard.addListener('keyboardWillHide', (e) => move(0, e.duration))
    return () => {
      frame.remove()
      hide.remove()
    }
  }, [])
  return { height }
}

/**
 * Bottom padding that keeps in-flow content (not floating chrome) snug above the keyboard, laid out with the keyboard's
 * own animation, the way KeyboardAvoidingView does it. Measured from the screen's bottom edge, so it is right inside
 * page sheets too, where KeyboardAvoidingView needs a guessed offset. The home-indicator padding is taken back out.
 */
export function useKeyboardInset() {
  const insets = useSafeAreaInsets()
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const move = (to: number, duration: number) => {
      if (duration)
        LayoutAnimation.configureNext({ duration, update: { duration, type: LayoutAnimation.Types.keyboard } })
      setHeight(to)
    }
    if (Platform.OS === 'android') {
      const show = Keyboard.addListener('keyboardDidShow', (e) => move(e.endCoordinates.height, 220))
      const hide = Keyboard.addListener('keyboardDidHide', () => move(0, 220))
      return () => {
        show.remove()
        hide.remove()
      }
    }
    if (Platform.OS !== 'ios') return
    const frame = Keyboard.addListener('keyboardWillChangeFrame', (e) =>
      move(Math.max(0, Dimensions.get('screen').height - e.endCoordinates.screenY), e.duration),
    )
    const hide = Keyboard.addListener('keyboardWillHide', (e) => move(0, e.duration))
    return () => {
      frame.remove()
      hide.remove()
    }
  }, [])
  return height ? Math.max(0, height - Math.max(0, insets.bottom - space.s)) : 0
}

/**
 * Pins its children to the bottom edge and lifts them above the keyboard. The home-indicator padding
 * the children carry is hidden behind the keys, so it is taken back out to keep them snug.
 */
export function KeyboardLift({
  keyboard,
  children,
  style,
}: {
  keyboard: ReturnType<typeof useKeyboardHeight>
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const insets = useSafeAreaInsets()
  // iOS: the home-indicator padding the children carry hides behind the keys, so lift a little less than the keyboard.
  // Android reports the keyboard height without the navigation-bar inset (edge to edge), so the children's own bottom
  // padding would sit under the keys: lift a little more instead, leaving them `space.s` above the keyboard.
  const slack = Platform.OS === 'android' ? -space.s : Math.max(0, insets.bottom - space.s)
  const lift = keyboard.height ? Math.max(0, keyboard.height - slack) : 0
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, style, { bottom: lift }]}>
      {children}
    </View>
  )
}

/** Shared floating input surface for threads and side questions. Keep keyboard lift and safe-area padding in one place. */
export function ComposerDock({
  children,
  onLayout,
}: {
  children: ReactNode
  onLayout?: (event: LayoutChangeEvent) => void
}) {
  const insets = useSafeAreaInsets()
  return (
    <View
      onLayout={onLayout}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: Math.max(insets.bottom, space.s),
        paddingTop: space.xs,
      }}
    >
      {children}
    </View>
  )
}
