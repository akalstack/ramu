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

import { MARK, MARK_VIEW_BOX, MARK_WAKE } from '@ramu/shared/brandMark'

// The desktop's AnimatedMark (apps/web/src/Brand.tsx): the r stem draws in and the dot drops onto it once per launch;
// tapping the mark wakes it again with the shared keyframes the startup screen uses.
const VIEW = MARK.size,
  ORIGIN = MARK.origin
const STEM = MARK.stem
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
    wake(hop)
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
  const { tilt, hopX, hopY, hopSX, hopSY } = wakeMotion(hop, k)
  const viewBox = MARK_VIEW_BOX
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
            <Circle {...MARK.dot} fill={MARK.dotColor} />
          </Svg>
        </Animated.View>
      </View>
    </Pressable>
  )
}

/** Plays the shared wake on a 0→1 value, on the native driver. */
export function wake(value: Animated.Value, done?: () => void) {
  value.setValue(0)
  Animated.timing(value, {
    toValue: 1,
    duration: MARK_WAKE.duration,
    easing: Easing.inOut(Easing.ease),
    useNativeDriver: true,
  }).start(({ finished }) => finished && done?.())
}

/** The shared wake keyframes as transforms for a mark drawn `k` points per artwork unit. */
export function wakeMotion(value: Animated.Value, k: number) {
  const dot = MARK_WAKE.dot
  const range = dot.map((frame) => frame.at)
  return {
    tilt: value.interpolate({
      inputRange: MARK_WAKE.stem.map((frame) => frame.at),
      outputRange: MARK_WAKE.stem.map((frame) => `${frame.rotate}deg`),
    }),
    hopX: value.interpolate({ inputRange: range, outputRange: dot.map((frame) => frame.x * k) }),
    hopY: value.interpolate({ inputRange: range, outputRange: dot.map((frame) => frame.y * k) }),
    hopSX: value.interpolate({ inputRange: range, outputRange: dot.map((frame) => frame.scaleX) }),
    hopSY: value.interpolate({ inputRange: range, outputRange: dot.map((frame) => frame.scaleY) }),
  }
}

/** The mark at rest that wakes on `value`: the startup screen's, where the launch image leaves it. */
export function WakingMark({ size, value }: { size: number; value: Animated.Value }) {
  const { c } = useTheme()
  const k = size / VIEW
  const { tilt, hopX, hopY, hopSX, hopSY } = wakeMotion(value, k)
  const at = (x: number, y: number) => ({
    left: 0,
    top: 0,
    width: size,
    height: size,
    position: 'absolute' as const,
    transformOrigin: [(x - ORIGIN) * k, (y - ORIGIN) * k, 0],
  })
  return (
    <View style={{ width: size, height: size, overflow: 'visible' }}>
      <Animated.View style={[at(MARK.stemPivot[0], MARK.stemPivot[1]), { transform: [{ rotate: tilt }] }]}>
        <Svg width={size} height={size} viewBox={MARK_VIEW_BOX}>
          <Path d={STEM} stroke={c.text} strokeWidth={120} strokeLinecap="round" fill="none" />
        </Svg>
      </Animated.View>
      <Animated.View
        style={[
          at(MARK.dot.cx, MARK.dot.cy),
          { transform: [{ translateX: hopX }, { translateY: hopY }, { scaleX: hopSX }, { scaleY: hopSY }] },
        ]}
      >
        <Svg width={size} height={size} viewBox={MARK_VIEW_BOX}>
          <Circle {...MARK.dot} fill={MARK.dotColor} />
        </Svg>
      </Animated.View>
    </View>
  )
}

const VIEW_BOX = MARK_VIEW_BOX

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
