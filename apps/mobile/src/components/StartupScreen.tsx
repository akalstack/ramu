import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, Platform, StyleSheet, View } from 'react-native'
import * as SplashScreen from 'expo-splash-screen'
import { MARK_WAKE, STARTUP_FADE, STARTUP_MARK_SIZE } from '@ramu/shared/brandMark'
import { useTheme } from '../theme'
import { useSay } from '../i18n'
import { WakingMark, wake } from './AnimatedMark'

if (Platform.OS !== 'web') void SplashScreen.preventAutoHideAsync().catch(() => {})

/**
 * The launch image's mark, at the same size and place, wakes once (the stem rocks, the dot hops) and fades into the app
 * when it is ready: the desktop's startup screen, from the same shared shapes and keyframes.
 */
export function StartupScreen({ ready, children }: { ready: boolean; children: ReactNode }) {
  const say = useSay()
  const { c } = useTheme()
  const motion = useRef(new Animated.Value(0)).current
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
    return () => {
      alive = false
      clearTimeout(timeout)
    }
  }, [])
  useEffect(() => {
    if (reduced === null) return
    if (reduced) return setMotionDone(true)
    wake(motion, () => setMotionDone(true))
    const fallback = setTimeout(() => setMotionDone(true), MARK_WAKE.duration + 600)
    return () => {
      motion.stopAnimation()
      clearTimeout(fallback)
    }
  }, [reduced, motion])
  useEffect(() => {
    if (!ready || !motionDone) return
    const animation = Animated.timing(opacity, {
      toValue: 0,
      duration: reduced ? 0 : STARTUP_FADE,
      useNativeDriver: true,
    })
    animation.start(({ finished }) => {
      if (finished) setClosed(true)
    })
    return () => animation.stop()
  }, [ready, motionDone, reduced, opacity])
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
          <WakingMark size={STARTUP_MARK_SIZE} value={motion} />
        </Animated.View>
      ) : null}
    </View>
  )
}
