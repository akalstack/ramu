import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AccessibilityInfo,
  Animated,
  Easing,
  LayoutAnimation,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { font, useTheme } from '../theme'
import { ChevronRight } from 'lucide-react-native'
import { T } from './ui'

/** Honors the system "Reduce Motion" setting, as the desktop does with prefers-reduced-motion. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    let alive = true
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduced(value)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced)
    return () => {
      alive = false
      subscription.remove()
    }
  }, [])
  return reduced
}

const WINDOW = 0.28

/**
 * The desktop's "Working…" shimmer: a highlight sweeping across muted text every 1.8 s. React Native cannot
 * clip a gradient to text without a native dependency, so each character brightens as the sweep passes it.
 */
export function Shimmer({
  children,
  size = font.control,
  style,
}: {
  children: string
  size?: number
  style?: StyleProp<TextStyle>
}) {
  const reduced = useReducedMotion()
  const sweep = useRef(new Animated.Value(-WINDOW)).current
  useEffect(() => {
    if (reduced) return
    const loop = Animated.loop(
      Animated.timing(sweep, { toValue: 1 + WINDOW, duration: 1800, easing: Easing.linear, useNativeDriver: true }),
    )
    loop.start()
    return () => loop.stop()
  }, [reduced, sweep])
  const characters = useMemo(() => [...children], [children])
  const { c } = useTheme()
  if (reduced)
    return (
      <T size={size} tone="muted" style={style}>
        {children}
      </T>
    )
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={children}
      style={{ flexDirection: 'row', flexWrap: 'wrap' }}
    >
      {characters.map((character, index) => {
        const at = characters.length > 1 ? index / (characters.length - 1) : 0
        const opacity = sweep.interpolate({
          inputRange: [at - WINDOW, at, at + WINDOW],
          outputRange: [0.45, 1, 0.45],
          extrapolate: 'clamp',
        })
        return (
          <Animated.Text
            key={index}
            importantForAccessibility="no"
            style={[{ fontSize: size, color: c.text, opacity, fontVariant: ['tabular-nums'] }, style]}
          >
            {character === ' ' ? ' ' : character}
          </Animated.Text>
        )
      })}
    </View>
  )
}

/** Entries that appear while the agent works rise 4 pt and fade in, like the desktop's `arrive` keyframe. */
export function Arrive({ animate, children }: { animate: boolean; children: ReactNode }) {
  const reduced = useReducedMotion()
  const progress = useRef(new Animated.Value(animate && !reduced ? 0 : 1)).current
  useEffect(() => {
    if (!animate || reduced) return
    Animated.timing(progress, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start()
  }, [animate, reduced, progress])
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [4, 0] })
  return <Animated.View style={{ opacity: progress, transform: [{ translateY }] }}>{children}</Animated.View>
}

/**
 * The reply being written: each growth of the text dips the block slightly and lets it settle, so new words
 * read dimmer for a moment, like the desktop's per-word fade.
 */
export function StreamIn({ text, active, children }: { text: string; active: boolean; children: ReactNode }) {
  const reduced = useReducedMotion()
  const opacity = useRef(new Animated.Value(1)).current
  const previous = useRef(text)
  useEffect(() => {
    if (!active || reduced || text === previous.current) {
      previous.current = text
      return
    }
    previous.current = text
    opacity.setValue(0.72)
    Animated.timing(opacity, {
      toValue: 1,
      duration: 380,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start()
  }, [text, active, reduced, opacity])
  return <Animated.View style={{ opacity }}>{children}</Animated.View>
}

// Read synchronously by one-shot animations (expand/collapse) that run outside a component's render.
let reduceMotion = false
void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
  reduceMotion = value
})
AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
  reduceMotion = value
})

/**
 * Animates the next layout change (a group opening or closing) with the platform's own layout animator:
 * Core Animation on iOS, Android's view animator on Android. Rows below slide instead of jumping.
 */
export function animateLayout(duration = 220) {
  if (reduceMotion) return
  LayoutAnimation.configureNext({
    duration,
    create: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
      duration: duration * 0.8,
    },
    update: { type: LayoutAnimation.Types.easeInEaseOut },
    delete: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
      duration: duration * 0.6,
    },
  })
}

/** A disclosure chevron that turns from right to down, as in iOS lists and Android expandable rows. */
export function Disclosure({ open, size = 14, color }: { open: boolean; size?: number; color: string }) {
  const turn = useRef(new Animated.Value(open ? 1 : 0)).current
  useEffect(() => {
    if (reduceMotion) {
      turn.setValue(open ? 1 : 0)
      return
    }
    Animated.timing(turn, {
      toValue: open ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start()
  }, [open, turn])
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] })
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <ChevronRight size={size} color={color} />
    </Animated.View>
  )
}

/** Keeps its child mounted while it fades and scales out, so floating buttons and toasts leave as smoothly as they arrive. */
/** `fade={false}` scales only: iOS liquid glass draws nothing under a parent whose opacity is animating. */
export function Presence({
  visible,
  children,
  style,
  fade = true,
}: {
  visible: boolean
  children: ReactNode
  style?: StyleProp<ViewStyle>
  fade?: boolean
}) {
  const [mounted, setMounted] = useState(visible)
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current
  useEffect(() => {
    if (visible) setMounted(true)
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : visible ? 180 : 140,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visible) setMounted(false)
    })
  }, [visible, progress])
  if (!mounted) return null
  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[
        style,
        {
          ...(fade ? { opacity: progress } : {}),
          transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [fade ? 0.92 : 0.01, 1] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  )
}
