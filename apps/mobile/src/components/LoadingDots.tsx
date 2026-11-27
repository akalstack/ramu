import { useEffect } from 'react'
import { View } from 'react-native'
import Reanimated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

const CYCLE = 1600
const STAGGER = 160 / CYCLE

/** One dot's lift and brightness at `phase` of the cycle, run on the UI thread. */
function Dot({ loop, offset, color }: { loop: SharedValue<number>; offset: number; color: string }) {
  const style = useAnimatedStyle(() => {
    const t = (loop.value - offset + 1) % 1
    // Up and back over the first 40% of its cycle, then rest, as the desktop's dots do.
    const rise = t < 0.4 ? Math.sin((t / 0.4) * Math.PI) : 0
    return { opacity: 0.35 + 0.65 * rise, transform: [{ translateY: -2.5 * rise }] }
  })
  return <Reanimated.View style={[{ width: 4, height: 4, borderRadius: 2, backgroundColor: color }, style]} />
}

/** The agent at work, as three gently bouncing dots in the surrounding text colour, like the desktop's. */
export function LoadingDots({ color }: { color: string }) {
  const reduced = useReducedMotion()
  const loop = useSharedValue(0)
  useEffect(() => {
    if (reduced) return
    loop.value = withRepeat(withTiming(1, { duration: CYCLE, easing: Easing.linear }), -1)
    return () => cancelAnimation(loop)
  }, [loop, reduced])
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height: 12 }} accessibilityElementsHidden>
      {[0, 1, 2].map((index) => (
        <Dot key={index} loop={loop} offset={index * STAGGER} color={color} />
      ))}
    </View>
  )
}
