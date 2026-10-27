import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View, useWindowDimensions } from 'react-native'
import Svg, { Circle, Path, SvgXml } from 'react-native-svg'
import * as SplashScreen from 'expo-splash-screen'
import { useTheme } from '../theme'
import { svgs } from '../assets/svgs'
import { useSay } from '../i18n'

if (Platform.OS !== 'web') void SplashScreen.preventAutoHideAsync().catch(() => {})

/** The desktop's r-and-dot-to-wordmark reveal, using native-driven transforms and opacity. */
export function StartupScreen({ ready, children }: { ready: boolean; children: ReactNode }) {
  const say = useSay()
  const { c } = useTheme()
  const { width } = useWindowDimensions()
  const scale = Math.min(280, width - 48) / 431.579
  const r = useRef(new Animated.Value(0)).current
  const dot = useRef(new Animated.Value(0)).current
  const letters = useRef(new Animated.Value(0)).current
  const opacity = useRef(new Animated.Value(1)).current
  const [reduced, setReduced] = useState<boolean | null>(null)
  const [motionDone, setMotionDone] = useState(false)
  const [closed, setClosed] = useState(false)
  useEffect(() => {
    let alive = true
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => alive && setReduced(value))
      .catch(() => alive && setReduced(false))
    const timeout = setTimeout(() => alive && setReduced((value) => value ?? false), 1000)
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced)
    return () => {
      alive = false
      clearTimeout(timeout)
      subscription.remove()
    }
  }, [])
  useEffect(() => {
    if (reduced === null || closed) return
    if (reduced) {
      r.setValue(1)
      dot.setValue(1)
      letters.setValue(1)
      setMotionDone(true)
      return
    }
    const move = (value: Animated.Value, delay: number, duration: number) =>
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(value, {
          toValue: 1,
          duration,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: true,
        }),
        Animated.delay(1200 - delay - duration),
      ])
    const animation = Animated.parallel([move(r, 288, 648), move(dot, 288, 720), move(letters, 408, 552)])
    animation.start(({ finished }) => {
      if (finished) setMotionDone(true)
    })
    const fallback = setTimeout(() => setMotionDone(true), 1800)
    return () => {
      animation.stop()
      clearTimeout(fallback)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when the listed dependencies change; other values are read as of that change
  }, [reduced, r, dot, letters])
  useEffect(() => {
    if (!ready || !motionDone) return
    const animation = Animated.timing(opacity, { toValue: 0, duration: reduced ? 0 : 200, useNativeDriver: true })
    animation.start(({ finished }) => {
      if (finished) setClosed(true)
    })
    return () => animation.stop()
  }, [ready, motionDone, reduced, opacity])
  const interpolate = (value: Animated.Value, start: number, end: number) =>
    value.interpolate({ inputRange: [0, 1], outputRange: [start * scale, end * scale] })
  return (
    <View
      style={{ flex: 1 }}
      onLayout={() => {
        if (Platform.OS !== 'web') void SplashScreen.hideAsync().catch(() => {})
      }}
    >
      <View
        style={{ flex: 1, opacity: closed ? 1 : 0 }}
        pointerEvents={closed ? 'auto' : 'none'}
        accessibilityElementsHidden={!closed}
        importantForAccessibility={closed ? 'auto' : 'no-hide-descendants'}
      >
        {children}
      </View>
      {!closed ? (
        <Animated.View
          accessibilityRole="progressbar"
          accessibilityLabel={say('Starting Ramu')}
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: c.canvas, opacity, alignItems: 'center', justifyContent: 'center' },
          ]}
        >
          <View style={{ width: 431.579 * scale, height: 136 * scale }}>
            <Animated.View
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                transform: [
                  { translateX: interpolate(r, 180.139, 32) },
                  { translateY: interpolate(r, 28.718, 28) },
                  { scale: r.interpolate({ inputRange: [0, 1], outputRange: [0.990291262, 1] }) },
                ],
              }}
            >
              <Svg width={52 * scale} height={80 * scale} viewBox="0 0 312 480">
                <Path
                  d="M60 420V244C60 128 138 60 252 60"
                  fill="none"
                  stroke={c.text}
                  strokeWidth={120}
                  strokeLinecap="round"
                />
              </Svg>
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: letters }]}>
              <SvgXml xml={svgs.startupLetters} width="100%" height="100%" color={c.text} />
            </Animated.View>
            <Animated.View
              style={{
                position: 'absolute',
                left: -10 * scale,
                top: -10 * scale,
                transform: [
                  { translateX: interpolate(dot, 240.877, 387.579) },
                  { translateY: interpolate(dot, 86.155, 98) },
                  { scale: dot.interpolate({ inputRange: [0, 1], outputRange: [1.188349515, 1] }) },
                ],
              }}
            >
              <Svg width={20 * scale} height={20 * scale} viewBox="0 0 20 20">
                <Circle cx={10} cy={10} r={10} fill="#7d6cff" />
              </Svg>
            </Animated.View>
          </View>
        </Animated.View>
      ) : null}
    </View>
  )
}
