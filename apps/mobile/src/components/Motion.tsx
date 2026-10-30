import { CHAT_MOTION, TOOL_MOTION } from '@ramu/shared/chat/presentation'
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
 * The desktop's "Working…" shimmer: a highlight sweeping across muted text every 2.2 s. React Native cannot
 * clip a gradient to text without a native dependency, so each character brightens as the sweep passes it.
 */
export function Shimmer({
  children,
  size = font.control,
  style,
  singleLine = false,
}: {
  children: string
  size?: number
  singleLine?: boolean
  style?: StyleProp<TextStyle>
}) {
  const reduced = useReducedMotion()
  const sweep = useRef(new Animated.Value(-WINDOW)).current
  useEffect(() => {
    if (reduced) return
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1 + WINDOW,
        duration: TOOL_MOTION.sweepMs,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
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
      style={{ flexDirection: 'row', flexWrap: singleLine ? 'nowrap' : 'wrap' }}
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

/** The same delayed completion highlight as desktop; the real text stays visible throughout. */
export function ActivityText({
  active,
  children,
  size = font.control,
}: {
  active: boolean
  children: string
  size?: number
}) {
  const reduced = useReducedMotion()
  const previous = useRef(active)
  const progress = useRef(new Animated.Value(1)).current
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const completed = previous.current && !active
    previous.current = active
    progress.setValue(1)
    if (!completed || reduced) return
    progress.setValue(0)
    const animation = Animated.timing(progress, {
      toValue: 1,
      delay: TOOL_MOTION.settleMs,
      duration: TOOL_MOTION.finishMs,
      easing: Easing.linear,
      useNativeDriver: false,
      isInteraction: false,
    })
    animation.start()
    return () => animation.stop()
  }, [active, reduced, progress])
  const clip = progress.interpolate({ inputRange: [0, TOOL_MOTION.fadeAt, 1], outputRange: ['0%', '100%', '100%'] })
  const opacity = progress.interpolate({ inputRange: [0, TOOL_MOTION.fadeAt, 1], outputRange: [1, 1, 0] })
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ minWidth: 0, overflow: 'hidden' }}>
      <T size={size} tone="muted" numberOfLines={1}>
        {children}
      </T>
      {active && !reduced ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
        >
          <Shimmer size={size} singleLine>
            {children.slice(0, 180)}
          </Shimmer>
        </View>
      ) : null}
      {!active && !reduced ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, width: clip, opacity, overflow: 'hidden' }}
        >
          <View style={{ width }}>
            <T size={size} numberOfLines={1}>
              {children}
            </T>
          </View>
        </Animated.View>
      ) : null}
    </View>
  )
}

export function Arrive({ animate, identity, children }: { animate: boolean; identity?: string; children: ReactNode }) {
  const reduced = useReducedMotion()
  const enter = useRef(animate).current
  const previousIdentity = useRef(identity)
  const progress = useRef(new Animated.Value(enter && !reduced ? 0 : 1)).current
  useEffect(() => {
    const changed = previousIdentity.current !== identity
    previousIdentity.current = identity
    if ((!enter && !changed) || reduced) {
      progress.setValue(1)
      return
    }
    progress.setValue(0)
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: CHAT_MOTION.durationMs,
      easing: Easing.bezier(...CHAT_MOTION.easing),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [enter, identity, reduced, progress])
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [CHAT_MOTION.rise, 0] })
  return <Animated.View style={{ opacity: progress, transform: [{ translateY }] }}>{children}</Animated.View>
}

/** Height and opacity disclosure motion, shared by every expandable transcript block. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const reduced = useReducedMotion()
  const [mounted, setMounted] = useState(open)
  const [height, setHeight] = useState(0)
  const size = useRef(new Animated.Value(0)).current
  const opacity = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (open) setMounted(true)
    const animation = Animated.parallel([
      Animated.timing(size, {
        toValue: open ? height : 0,
        duration: reduced ? 0 : 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(opacity, {
        toValue: open ? 1 : 0,
        duration: reduced ? 0 : 160,
        useNativeDriver: false,
      }),
    ])
    animation.start(({ finished }) => {
      if (finished && !open) setMounted(false)
    })
    return () => animation.stop()
  }, [open, height, reduced, size, opacity])
  if (!open && !mounted) return null
  return (
    <Animated.View
      pointerEvents={open ? 'auto' : 'none'}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
      style={{ height: size, opacity, overflow: 'hidden' }}
    >
      <View
        onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
        style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
      >
        {children}
      </View>
    </Animated.View>
  )
}

/** A soft breathing pulse while `active` (a tool still running), settling back to full opacity when it stops. */
export function Breathe({ active, children }: { active: boolean; children: ReactNode }) {
  const reduced = useReducedMotion()
  const opacity = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (!active || reduced) {
      Animated.timing(opacity, {
        toValue: 1,
        duration: reduced ? 0 : 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start()
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [active, reduced, opacity])
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
  const reduced = useReducedMotion()
  const turn = useRef(new Animated.Value(open ? 1 : 0)).current
  useEffect(() => {
    if (reduced) {
      turn.setValue(open ? 1 : 0)
      return
    }
    Animated.timing(turn, {
      toValue: open ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start()
  }, [open, reduced, turn])
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
