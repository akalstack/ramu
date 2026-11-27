import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import Reanimated, {
  cancelAnimation,
  Easing as ReEasing,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
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
  const drop = useSharedValue(first ? 0 : 1)
  const hop = useSharedValue(0)
  useEffect(() => {
    if (!first) return
    revealed = true
    if (reduced) {
      draw.value = 1
      drop.value = 1
      return
    }
    draw.value = withTiming(1, { duration: 850, easing: ReEasing.bezier(0.22, 1, 0.36, 1) })
    drop.value = withDelay(420, withTiming(1, { duration: 620, easing: ReEasing.linear }))
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
  const { stemStyle, dotStyle } = useWakeStyles(hop, k, drop)
  const viewBox = MARK_VIEW_BOX
  const stem = useAnimatedProps(() => ({
    strokeDashoffset: STEM_LENGTH * (1 - draw.value),
    opacity: interpolate(draw.value, [0, 0.12, 1], [0, 1, 1]),
  }))
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={say('Animate Ramu logo')} onPress={replay} hitSlop={8}>
      <View style={{ width: size, height: size, overflow: 'visible' }}>
        <Reanimated.View pointerEvents="none" style={[at(356, 694), stemStyle]}>
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
        </Reanimated.View>
        <Reanimated.View pointerEvents="none" style={[at(664, 622), dotStyle]}>
          <Svg width={size} height={size} viewBox={viewBox}>
            <Circle {...MARK.dot} fill={MARK.dotColor} />
          </Svg>
        </Reanimated.View>
      </View>
    </Pressable>
  )
}

/** Plays the shared wake on a 0→1 value, on the UI thread. */
export function wake(value: SharedValue<number>, done?: () => void) {
  value.value = 0
  value.value = withTiming(1, { duration: MARK_WAKE.duration, easing: ReEasing.inOut(ReEasing.ease) }, (finished) => {
    if (finished && done) scheduleOnRN(done)
  })
}

const STEM_AT = MARK_WAKE.stem.map((frame) => frame.at)
const STEM_TURN = MARK_WAKE.stem.map((frame) => frame.rotate)
const DOT_AT = MARK_WAKE.dot.map((frame) => frame.at)
const DOT_X = MARK_WAKE.dot.map((frame) => frame.x)
const DOT_Y = MARK_WAKE.dot.map((frame) => frame.y)
const DOT_SX = MARK_WAKE.dot.map((frame) => frame.scaleX)
const DOT_SY = MARK_WAKE.dot.map((frame) => frame.scaleY)
const DROP_AT = [0, 0.48, 0.72, 0.88, 1]

/**
 * The shared wake keyframes as styles for a mark drawn `k` points per artwork unit, and, with `drop`, the dot falling
 * onto the stem the first time it shows.
 */
function useWakeStyles(value: SharedValue<number>, k: number, drop?: SharedValue<number>) {
  const stemStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(value.value, STEM_AT, STEM_TURN)}deg` }],
  }))
  const dotStyle = useAnimatedStyle(() => {
    const v = value.value
    const d = drop ? drop.value : 1
    return {
      opacity: drop ? interpolate(d, [0, 0.48, 1], [0, 1, 1]) : 1,
      transform: [
        { translateX: interpolate(v, DOT_AT, DOT_X) * k },
        { translateY: interpolate(v, DOT_AT, DOT_Y) * k + interpolate(d, DROP_AT, [-130, 8, -22, 3, 0]) * k },
        { scaleX: interpolate(v, DOT_AT, DOT_SX) * interpolate(d, DROP_AT, [0.45, 1.16, 0.94, 1.03, 1]) },
        { scaleY: interpolate(v, DOT_AT, DOT_SY) * interpolate(d, DROP_AT, [0.45, 0.84, 1.06, 0.97, 1]) },
      ],
    }
  })
  return { stemStyle, dotStyle }
}

/** The mark at rest that wakes on `value`: the startup screen's, where the launch image leaves it. */
export function WakingMark({ size, value }: { size: number; value: SharedValue<number> }) {
  const { c } = useTheme()
  const k = size / VIEW
  const { stemStyle, dotStyle } = useWakeStyles(value, k)
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
      <Reanimated.View style={[at(MARK.stemPivot[0], MARK.stemPivot[1]), stemStyle]}>
        <Svg width={size} height={size} viewBox={MARK_VIEW_BOX}>
          <Path d={STEM} stroke={c.text} strokeWidth={120} strokeLinecap="round" fill="none" />
        </Svg>
      </Reanimated.View>
      <Reanimated.View style={[at(MARK.dot.cx, MARK.dot.cy), dotStyle]}>
        <Svg width={size} height={size} viewBox={MARK_VIEW_BOX}>
          <Circle {...MARK.dot} fill={MARK.dotColor} />
        </Svg>
      </Reanimated.View>
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
