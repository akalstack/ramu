import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Pressable, View } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import Reanimated, {
  cancelAnimation,
  Easing as ReEasing,
  interpolate,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { useTheme } from '../theme'
import { useReducedMotion } from './Motion'
import { tap as haptic } from './ui'
import { useSay } from '../i18n'

// The desktop's AnimatedMark (apps/web/src/Brand.tsx): the r stem draws in and the dot drops onto it once per launch;
// tapping the mark makes the dot hop again. Same geometry, same keyframes (styles.css ramu-stem/dot/tap-*).
const VIEW = 540,
  ORIGIN = 240
const STEM = 'M356 694V518C356 402 434 334 548 334'
const STEM_LENGTH = 440
let revealed = false

export function AnimatedMark({ size = 56 }: { size?: number }) {
  const say = useSay()
  const { c } = useTheme()
  const reduced = useReducedMotion()
  const k = size / VIEW
  const [first] = useState(() => !revealed)
  const draw = useSharedValue(first ? 0 : 1)
  const drop = useRef(new Animated.Value(first ? 0 : 1)).current
  const hop = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!first) return
    revealed = true
    if (reduced) {
      draw.value = 1
      drop.setValue(1)
      return
    }
    // The stem's dash is an SVG prop, which the native driver cannot move; Reanimated draws it on the UI thread.
    draw.value = withTiming(1, { duration: 850, easing: ReEasing.bezier(0.22, 1, 0.36, 1) })
    Animated.timing(drop, {
      toValue: 1,
      duration: 620,
      delay: 420,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [mount only] by design; the values it reads beyond these are current as of that run
  }, [])
  const replay = () => {
    haptic()
    if (reduced) return
    hop.setValue(0)
    Animated.timing(hop, {
      toValue: 1,
      duration: 650,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start()
  }
  // Numbers, not a "12.03px" string: RN's transformOrigin parser only reads whole numbers before px, so a decimal like 12.03px
  // became 3px…29629 and flung the dot and stem off screen whenever they scaled or rotated.
  const at = (x: number, y: number) => ({
    left: 0,
    top: 0,
    width: size,
    height: size,
    position: 'absolute' as const,
    transformOrigin: [(x - ORIGIN) * k, (y - ORIGIN) * k, 0],
  })
  // ramu-dot (reveal) and ramu-tap-dot (tap) compose: both rest at identity.
  const dropY = drop.interpolate({
    inputRange: [0, 0.48, 0.72, 0.88, 1],
    outputRange: [-130, 8, -22, 3, 0].map((v) => v * k),
  })
  const dropX = drop.interpolate({ inputRange: [0, 0.48, 0.72, 0.88, 1], outputRange: [0.45, 1.16, 0.94, 1.03, 1] })
  const dropSY = drop.interpolate({ inputRange: [0, 0.48, 0.72, 0.88, 1], outputRange: [0.45, 0.84, 1.06, 0.97, 1] })
  const dropOpacity = drop.interpolate({ inputRange: [0, 0.48, 1], outputRange: [0, 1, 1] })
  const hopRange = [0, 0.18, 0.46, 0.76, 0.9, 1]
  const hopX = hop.interpolate({ inputRange: hopRange, outputRange: [0, 0, 30, 0, 0, 0].map((v) => v * k) })
  const hopY = hop.interpolate({ inputRange: hopRange, outputRange: [0, 8, -110, 6, -10, 0].map((v) => v * k) })
  const hopSX = hop.interpolate({ inputRange: hopRange, outputRange: [1, 1.18, 0.9, 1.12, 0.97, 1] })
  const hopSY = hop.interpolate({ inputRange: hopRange, outputRange: [1, 0.82, 1.1, 0.88, 1.03, 1] })
  const tilt = hop.interpolate({
    inputRange: [0, 0.28, 0.62, 0.82, 1],
    outputRange: ['0deg', '-9deg', '4deg', '-2deg', '0deg'],
  })
  const viewBox = `${ORIGIN} ${ORIGIN} ${VIEW} ${VIEW}`
  const stem = useAnimatedProps(() => ({
    strokeDashoffset: STEM_LENGTH * (1 - draw.value),
    opacity: interpolate(draw.value, [0, 0.12, 1], [0, 1, 1]),
  }))
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={say('Animate Ramu logo')} onPress={replay} hitSlop={8}>
      <View style={{ width: size, height: size, overflow: 'visible' }}>
        <Animated.View pointerEvents="none" style={[at(356, 694), { transform: [{ rotate: tilt }] }]}>
          <Svg width={size} height={size} viewBox={viewBox}>
            <WorkletPath
              d={STEM}
              stroke={c.text}
              strokeWidth={120}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={[STEM_LENGTH, STEM_LENGTH]}
              animatedProps={stem}
            />
          </Svg>
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[
            at(664, 622),
            {
              opacity: dropOpacity,
              transform: [
                { translateX: hopX },
                { translateY: Animated.add(dropY, hopY) },
                { scaleX: Animated.multiply(dropX, hopSX) },
                { scaleY: Animated.multiply(dropSY, hopSY) },
              ],
            },
          ]}
        >
          <Svg width={size} height={size} viewBox={viewBox}>
            <Circle cx={664} cy={622} r={72} fill="#7d6cff" />
          </Svg>
        </Animated.View>
      </View>
    </Pressable>
  )
}

const VIEW_BOX = `${ORIGIN} ${ORIGIN} ${VIEW} ${VIEW}`

/** The r + dot in one color: Ramu's own tool calls in a chat, sized like any other tool icon. */
export function RamuGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox={VIEW_BOX}>
      <Path d={STEM} stroke={color} strokeWidth={120} strokeLinecap="round" fill="none" />
      <Circle cx={664} cy={622} r={72} fill={color} />
    </Svg>
  )
}

const WorkletPath = Reanimated.createAnimatedComponent(Path)
const WorkletCircle = Reanimated.createAnimatedComponent(Circle)
const EASE = ReEasing.bezierFn(0.65, 0, 0.35, 1)

/**
 * Waiting on Ramu itself, such as a thread opening: the desktop's loading mark. The stem traces over a faint copy while
 * the dot settles, on a loop; with reduced motion it holds still at full strength.
 */
export function LoadingMark({ size = 28, color, label }: { size?: number; color: string; label: string }) {
  const reduced = useReducedMotion()
  const loop = useSharedValue(0)
  useEffect(() => {
    if (reduced) return
    loop.value = withRepeat(withTiming(1, { duration: 1800, easing: ReEasing.linear }), -1)
    return () => cancelAnimation(loop)
  }, [loop, reduced])
  // On the UI thread, so the mark keeps its pace while JavaScript is busy laying out a long thread.
  const stem = useAnimatedProps(() => {
    const t = loop.value
    const offset = t < 0.45 ? STEM_LENGTH * (1 - EASE(t / 0.45)) : t < 0.6 ? 0 : -STEM_LENGTH * EASE((t - 0.6) / 0.4)
    return { strokeDashoffset: reduced ? 0 : offset }
  })
  const dot = useAnimatedProps(() => {
    const t = loop.value
    return {
      r: reduced ? 72 : interpolate(t, [0, 0.3, 0.5, 0.62, 1], [43, 43, 79, 72, 43]),
      opacity: reduced ? 1 : interpolate(t, [0, 0.3, 0.5, 0.62, 1], [0.2, 0.2, 1, 1, 0.2]),
    }
  })
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label}>
      <Svg width={size} height={size} viewBox={VIEW_BOX}>
        <Path d={STEM} stroke={color} strokeOpacity={0.18} strokeWidth={120} strokeLinecap="round" fill="none" />
        <WorkletPath
          d={STEM}
          stroke={color}
          strokeWidth={120}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={[STEM_LENGTH, STEM_LENGTH]}
          animatedProps={stem}
        />
        <WorkletCircle cx={664} cy={622} fill={color} animatedProps={dot} />
      </Svg>
    </View>
  )
}
