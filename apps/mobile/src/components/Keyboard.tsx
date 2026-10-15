import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, Dimensions, Easing, Keyboard, LayoutAnimation, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { space } from '../theme'

/**
 * Keyboard height, animated with the keyboard's own curve on iOS. Android (edge-to-edge, so the window is not
 * resized for the keyboard) only reports after the keyboard has moved, so its lift uses a short standard ease. KeyboardAvoidingView only pads, so
 * it cannot move absolutely positioned chrome (the floating composer and search bar); this can.
 */
export function useKeyboardHeight(onWillMove?: (to: number) => void) {
  const value = useRef(new Animated.Value(0)).current
  const [height, setHeight] = useState(0)
  const notify = useRef(onWillMove); notify.current = onWillMove
  useEffect(() => {
    const move = (to: number, duration: number) => {
      // Before the state change renders, so a screen can note whether the reader was at the bottom.
      notify.current?.(to)
      setHeight(to)
      Animated.timing(value, { toValue: to, duration: duration || 220, easing: Platform.OS === 'ios' ? Easing.bezier(0.17, 0.59, 0.4, 0.77) : Easing.out(Easing.cubic), useNativeDriver: true }).start()
    }
    if (Platform.OS === 'android') {
      const show = Keyboard.addListener('keyboardDidShow', (e) => move(e.endCoordinates.height, 0))
      const hide = Keyboard.addListener('keyboardDidHide', () => move(0, 0))
      return () => { show.remove(); hide.remove() }
    }
    if (Platform.OS !== 'ios') return
    const frame = Keyboard.addListener('keyboardWillChangeFrame', (e) => move(Math.max(0, Dimensions.get('window').height - e.endCoordinates.screenY), e.duration))
    const hide = Keyboard.addListener('keyboardWillHide', (e) => move(0, e.duration))
    return () => { frame.remove(); hide.remove() }
  }, [value])
  return { value, height }
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
      if (duration) LayoutAnimation.configureNext({ duration, update: { duration, type: LayoutAnimation.Types.keyboard } })
      setHeight(to)
    }
    if (Platform.OS === 'android') {
      const show = Keyboard.addListener('keyboardDidShow', (e) => move(e.endCoordinates.height, 220))
      const hide = Keyboard.addListener('keyboardDidHide', () => move(0, 220))
      return () => { show.remove(); hide.remove() }
    }
    if (Platform.OS !== 'ios') return
    const frame = Keyboard.addListener('keyboardWillChangeFrame', (e) => move(Math.max(0, Dimensions.get('screen').height - e.endCoordinates.screenY), e.duration))
    const hide = Keyboard.addListener('keyboardWillHide', (e) => move(0, e.duration))
    return () => { frame.remove(); hide.remove() }
  }, [])
  return height ? Math.max(0, height - Math.max(0, insets.bottom - space.s)) : 0
}

/**
 * Pins its children to the bottom edge and lifts them above the keyboard. The home-indicator padding
 * the children carry is hidden behind the keys, so it is taken back out to keep them snug.
 */
export function KeyboardLift({ keyboard, children, style }: { keyboard: ReturnType<typeof useKeyboardHeight>; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets()
  const slack = Math.max(0, insets.bottom - space.s)
  const translateY = useMemo(() => keyboard.value.interpolate({ inputRange: [0, 1, 2000], outputRange: [0, slack - 1, slack - 2000] }), [keyboard.value, slack])
  return <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, style, { transform: [{ translateY }] }]}>{children}</Animated.View>
}
