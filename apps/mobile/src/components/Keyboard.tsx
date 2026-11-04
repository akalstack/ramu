import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Dimensions,
  Keyboard,
  LayoutAnimation,
  Platform,
  StyleSheet,
  UIManager,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { KeyboardProvider, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import Reanimated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
  useDerivedValue,
  type SharedValue,
} from 'react-native-reanimated'
import { space } from '../theme'

/**
 * Whether this app binary has the native keyboard tracker. Builds made before it was added do not, and drawing its view
 * there fails, so those keep the JavaScript lift below.
 */
export const nativeKeyboard = (() => {
  if (Platform.OS === 'web') return false
  try {
    return UIManager.hasViewManagerConfig('KeyboardControllerView')
  } catch {
    return false
  }
})()

/** Reports the system keyboard's frame to the UI thread every frame, so lifted chrome moves with the keys exactly. */
export function KeyboardMotion({ children }: { children: ReactNode }) {
  return nativeKeyboard ? <KeyboardProvider>{children}</KeyboardProvider> : <>{children}</>
}

/**
 * The keyboard's resting height, for a screen's own logic (scroll insets, following the end). It does not animate:
 * KeyboardLift moves the chrome with the keys on the UI thread.
 *
 * The lift moves layout, not a transform: the New Architecture measures views without a transform, so a button lifted by
 * one is measured where it would sit with the keyboard closed, and a tap that moves a hair is cancelled.
 */
export function useKeyboardHeight(onWillMove?: (to: number) => void) {
  const [height, setHeight] = useState(0)
  const notify = useRef(onWillMove)
  notify.current = onWillMove
  useEffect(() => {
    // Only the screen's own logic reads this; the lift follows the keys on the UI thread (KeyboardLift). Animating every
    // layout through JavaScript started late on a busy screen and dragged behind the keyboard.
    const move = (to: number) => {
      // Before the state change renders, so a screen can note whether the reader was at the bottom.
      notify.current?.(to)
      setHeight(to)
    }
    if (Platform.OS === 'android') {
      const show = Keyboard.addListener('keyboardDidShow', (e) => move(e.endCoordinates.height))
      const hide = Keyboard.addListener('keyboardDidHide', () => move(0))
      return () => {
        show.remove()
        hide.remove()
      }
    }
    if (Platform.OS !== 'ios') return
    const frame = Keyboard.addListener('keyboardWillChangeFrame', (e) =>
      move(Math.max(0, Dimensions.get('window').height - e.endCoordinates.screenY)),
    )
    const hide = Keyboard.addListener('keyboardWillHide', () => move(0))
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
  if (Platform.OS !== 'web')
    return (
      <NativeLift slack={slack} lift={keyboard.height ? Math.max(0, keyboard.height - slack) : 0} style={style}>
        {children}
      </NativeLift>
    )
  const lift = keyboard.height ? Math.max(0, keyboard.height - slack) : 0
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, style, { bottom: lift }]}>
      {children}
    </View>
  )
}

function useControllerFrame(): SharedValue<number> {
  const { height } = useReanimatedKeyboardAnimation()
  // It runs from 0 to minus the keyboard's height, ready for a translate; layout takes the positive height instead.
  return useDerivedValue(() => -height.value)
}

function useReanimatedFrame(): SharedValue<number> {
  return useAnimatedKeyboard().height
}

/**
 * The keyboard's height on the UI thread, every frame of the system's own animation. Builds with keyboard-controller use
 * it; older ones use Reanimated's tracker, which every build has. Chosen once, so the hooks never change between renders.
 */
const useKeyboardFrame = nativeKeyboard ? useControllerFrame : useReanimatedFrame

/** The lift, frame by frame on the UI thread, in step with the system keyboard's own animation. */
/**
 * Layout goes straight to where the keyboard will rest, so a tap is measured at the button's real place from the start;
 * a translate covers the distance the keys have yet to travel and reaches zero as they settle. Animating layout from
 * the UI thread left Pressable measuring the old place, and the first tap on Send was cancelled.
 */
function NativeLift({
  slack,
  lift,
  style,
  children,
}: {
  slack: number
  /** Where the keyboard rests, from its will-show event. */
  lift: number
  style?: StyleProp<ViewStyle>
  children: ReactNode
}) {
  const height = useKeyboardFrame()
  // Reanimated's plugin captures lift and slack itself; a dependency list is for the web and warns on a phone.
  const following = useAnimatedStyle(() => ({ transform: [{ translateY: lift - Math.max(0, height.value - slack) }] }))
  return (
    <Reanimated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, style, { bottom: lift }, following]}>
      {children}
    </Reanimated.View>
  )
}

/** Whether the keyboard is up or on its way, for content that changes with it; the motion itself is KeyboardPadding's. */
export function useKeyboardOpen() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const [show, hide] =
      Platform.OS === 'ios' ? ['keyboardWillShow', 'keyboardWillHide'] : ['keyboardDidShow', 'keyboardDidHide']
    const up = Keyboard.addListener(show as 'keyboardWillShow', () => setOpen(true))
    const down = Keyboard.addListener(hide as 'keyboardWillHide', () => setOpen(false))
    return () => {
      up.remove()
      down.remove()
    }
  }, [])
  return open
}

/**
 * In-flow content kept snug above the keyboard, padded frame by frame with the keyboard's own animation. The
 * home-indicator padding the content carries is taken back out, as useKeyboardInset does.
 */
export function KeyboardPadding({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const insets = useSafeAreaInsets()
  const slack = Platform.OS === 'android' ? 0 : Math.max(0, insets.bottom - space.s)
  return Platform.OS === 'web' ? (
    <WebPadding style={style}>{children}</WebPadding>
  ) : (
    <NativePadding slack={slack} style={style}>
      {children}
    </NativePadding>
  )
}

function WebPadding({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return <View style={[style, { paddingBottom: useKeyboardInset() }]}>{children}</View>
}

function NativePadding({
  slack,
  style,
  children,
}: {
  slack: number
  style?: StyleProp<ViewStyle>
  children: ReactNode
}) {
  // As in NativeLift: the padding is where the keyboard will rest, and a translate covers what is left of its travel.
  const rest = useKeyboardHeight().height
  const padding = rest ? Math.max(0, rest - slack) : 0
  const height = useKeyboardFrame()
  // What the keyboard has yet to travel, on the UI thread: the padded content is pushed back by it.
  const travel = useDerivedValue(() => padding - Math.max(0, height.value - slack))
  const following = useAnimatedStyle(() => ({ transform: [{ translateY: travel.value }] }))
  return (
    <KeyboardTravel.Provider value={travel}>
      <Reanimated.View style={[style, { paddingBottom: padding }, following]}>{children}</Reanimated.View>
    </KeyboardTravel.Provider>
  )
}

const KeyboardTravel = createContext<SharedValue<number> | null>(null)

/**
 * Content centred in the space above the keyboard (the new-thread mark and question). Centring moves it half as far
 * as the keyboard, but the padding around it jumps to the keyboard's resting height at once; without this it ran
 * ahead of the keys for a few frames and snapped back. It takes back half the remaining travel, on the UI thread.
 */
export function KeyboardCentered({ children }: { children: ReactNode }) {
  const travel = useContext(KeyboardTravel)
  if (!travel) return <View>{children}</View>
  return <CenteredInTravel travel={travel}>{children}</CenteredInTravel>
}

function CenteredInTravel({ travel, children }: { travel: SharedValue<number>; children: ReactNode }) {
  const half = useAnimatedStyle(() => ({ transform: [{ translateY: -travel.value / 2 }] }))
  return <Reanimated.View style={half}>{children}</Reanimated.View>
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
