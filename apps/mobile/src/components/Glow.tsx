import { useEffect, type ReactNode } from 'react'
import { View } from 'react-native'
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { radius, useTheme } from '../theme'
import { useReducedMotion } from './Motion'

/**
 * Lights what it wraps once each time `pulse` changes to a new value: an accent wash and outline arrive, hold long
 * enough to be found, and fade, as the desktop marks a found setting or message. `delay` lets a scroll finish first;
 * `bleed` reaches past the content's sides (a message's text) or, negative, stays inside them (a row in a card).
 */
export function Glow({
  pulse,
  delay = 0,
  bleed = 6,
  children,
}: {
  pulse: number | null
  delay?: number
  bleed?: number
  children: ReactNode
}) {
  const { c } = useTheme()
  const reduced = useReducedMotion()
  const shown = useSharedValue(0)
  useEffect(() => {
    if (pulse === null) return
    const fadeIn = withTiming(1, { duration: reduced ? 0 : 200, easing: Easing.out(Easing.quad) })
    const fadeOut = withTiming(0, { duration: reduced ? 0 : 700, easing: Easing.in(Easing.quad) })
    shown.value = withDelay(reduced ? 0 : delay, withSequence(fadeIn, withDelay(reduced ? 1600 : 1100, fadeOut)))
  }, [pulse, delay, reduced, shown])
  const style = useAnimatedStyle(() => ({ opacity: shown.value }))
  return (
    <View>
      {pulse !== null ? (
        <Reanimated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 2,
              bottom: 2,
              left: -bleed,
              right: -bleed,
              borderRadius: radius.m,
              backgroundColor: c.accentWash,
              borderWidth: 1,
              borderColor: c.accent,
            },
            style,
          ]}
        />
      ) : null}
      {children}
    </View>
  )
}
