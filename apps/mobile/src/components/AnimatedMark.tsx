import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Pressable, View } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
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
const AnimatedPath = Animated.createAnimatedComponent(Path)
let revealed = false

export function AnimatedMark({ size = 56 }: { size?: number }) {
  const say = useSay()
  const { c } = useTheme()
  const reduced = useReducedMotion()
  const k = size / VIEW
  const [first] = useState(() => !revealed)
  const draw = useRef(new Animated.Value(first ? 0 : 1)).current
  const drop = useRef(new Animated.Value(first ? 0 : 1)).current
  const hop = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!first) return
    revealed = true
    if (reduced) {
      draw.setValue(1)
      drop.setValue(1)
      return
    }
    Animated.parallel([
      Animated.timing(draw, {
        toValue: 1,
        duration: 850,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: false,
      }),
      Animated.timing(drop, { toValue: 1, duration: 620, delay: 420, easing: Easing.linear, useNativeDriver: true }),
    ]).start()
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
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={say('Animate Ramu logo')} onPress={replay} hitSlop={8}>
      <View style={{ width: size, height: size, overflow: 'visible' }}>
        <Animated.View pointerEvents="none" style={[at(356, 694), { transform: [{ rotate: tilt }] }]}>
          <Svg width={size} height={size} viewBox={viewBox}>
            <AnimatedPath
              d={STEM}
              stroke={c.text}
              strokeWidth={120}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={[STEM_LENGTH, STEM_LENGTH]}
              strokeDashoffset={draw.interpolate({ inputRange: [0, 1], outputRange: [STEM_LENGTH, 0] })}
              opacity={draw.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 1, 1] })}
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
