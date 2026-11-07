import { CHAT_MOTION, TOOL_MOTION } from '@ramu/shared/chat/presentation'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, LayoutAnimation, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import Reanimated, {
  cancelAnimation,
  Easing as ReEasing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
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
  const sweep = useSharedValue(-WINDOW)
  useEffect(() => {
    if (reduced) return
    // Each pass rests off the end before the next, like the desktop's highlight that slides past the text.
    sweep.value = -WINDOW
    sweep.value = withRepeat(
      withSequence(
        withTiming(1 + WINDOW, { duration: TOOL_MOTION.sweepMs, easing: ReEasing.inOut(ReEasing.quad) }),
        withDelay(TOOL_MOTION.restMs, withTiming(-WINDOW, { duration: 0 })),
      ),
      -1,
    )
    return () => cancelAnimation(sweep)
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
      {characters.map((character, index) => (
        <ShimmerCharacter
          key={index}
          sweep={sweep}
          at={characters.length > 1 ? index / (characters.length - 1) : 0}
          style={[{ fontSize: size, color: c.text, fontVariant: ['tabular-nums'] }, style]}
        >
          {character === ' ' ? '\u00a0' : character}
        </ShimmerCharacter>
      ))}
    </View>
  )
}

/** One character of the shimmer, brightened on the UI thread as the sweep passes it. */
function ShimmerCharacter({
  sweep,
  at,
  style,
  children,
}: {
  sweep: SharedValue<number>
  at: number
  style: StyleProp<TextStyle>
  children: string
}) {
  const animated = useAnimatedStyle(() => ({
    opacity: interpolate(sweep.value, [at - WINDOW, at, at + WINDOW], [0.45, 1, 0.45], Extrapolation.CLAMP),
  }))
  return (
    <Reanimated.Text importantForAccessibility="no" style={[style, animated]}>
      {children}
    </Reanimated.Text>
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
  const progress = useSharedValue(1)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const completed = previous.current && !active
    previous.current = active
    if (!completed || reduced) {
      progress.value = 1
      return
    }
    // The wipe resizes its clip, which the native driver cannot do; Reanimated runs it on the UI thread.
    progress.value = 0
    progress.value = withDelay(
      TOOL_MOTION.settleMs,
      withTiming(1, { duration: TOOL_MOTION.finishMs, easing: ReEasing.linear }),
    )
    return () => cancelAnimation(progress)
  }, [active, reduced, progress])
  const wipe = useAnimatedStyle(() => ({
    width: `${interpolate(progress.value, [0, TOOL_MOTION.fadeAt, 1], [0, 100, 100])}%`,
    opacity: interpolate(progress.value, [0, TOOL_MOTION.fadeAt, 1], [1, 1, 0]),
  }))
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ minWidth: 0, overflow: 'hidden' }}>
      {/* While the shimmer runs it is the only copy shown; drawing both put two slightly offset labels on top of each other. */}
      <T size={size} tone="muted" numberOfLines={1} style={active && !reduced ? { opacity: 0 } : undefined}>
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
        <Reanimated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[{ position: 'absolute', top: 0, left: 0, overflow: 'hidden' }, wipe]}
        >
          <View style={{ width }}>
            <T size={size} numberOfLines={1}>
              {children}
            </T>
          </View>
        </Reanimated.View>
      ) : null}
    </View>
  )
}

export function Arrive({ animate, identity, children }: { animate: boolean; identity?: string; children: ReactNode }) {
  const reduced = useReducedMotion()
  const enter = useRef(animate).current
  const previousIdentity = useRef(identity)
  const progress = useSharedValue(enter && !reduced ? 0 : 1)
  useEffect(() => {
    const changed = previousIdentity.current !== identity
    previousIdentity.current = identity
    if ((!enter && !changed) || reduced) {
      progress.value = 1
      return
    }
    progress.value = 0
    progress.value = withTiming(1, {
      duration: CHAT_MOTION.durationMs,
      easing: ReEasing.bezier(...CHAT_MOTION.easing),
    })
    return () => cancelAnimation(progress)
  }, [enter, identity, reduced, progress])
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * CHAT_MOTION.rise }],
  }))
  return <Reanimated.View style={style}>{children}</Reanimated.View>
}

/** Height and opacity disclosure motion, shared by every expandable transcript block. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const reduced = useReducedMotion()
  const [mounted, setMounted] = useState(open)
  const [height, setHeight] = useState(0)
  // On the UI thread, so a block opens smoothly even while a long transcript keeps JavaScript busy.
  const size = useSharedValue(0)
  const opacity = useSharedValue(0)
  useEffect(() => {
    if (open) setMounted(true)
    const done = (finished?: boolean) => {
      if (finished && !open) setMounted(false)
    }
    size.value = withTiming(
      open ? height : 0,
      { duration: reduced ? 0 : 200, easing: ReEasing.out(ReEasing.cubic) },
      (finished) => scheduleOnRN(done, finished),
    )
    opacity.value = withTiming(open ? 1 : 0, { duration: reduced ? 0 : 160 })
  }, [open, height, reduced, size, opacity])
  const style = useAnimatedStyle(() => ({ height: size.value, opacity: opacity.value }))
  if (!open && !mounted) return null
  return (
    <Reanimated.View
      pointerEvents={open ? 'auto' : 'none'}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
      style={[{ overflow: 'hidden' }, style]}
    >
      <View
        onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
        style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
      >
        {children}
      </View>
    </Reanimated.View>
  )
}

/** A soft breathing pulse while `active` (a tool still running), settling back to full opacity when it stops. */
export function Breathe({ active, children }: { active: boolean; children: ReactNode }) {
  const reduced = useReducedMotion()
  const opacity = useSharedValue(1)
  useEffect(() => {
    if (!active || reduced) {
      opacity.value = withTiming(1, { duration: reduced ? 0 : 220, easing: ReEasing.out(ReEasing.quad) })
      return
    }
    const half = { duration: 700, easing: ReEasing.inOut(ReEasing.sin) }
    opacity.value = withRepeat(withSequence(withTiming(0.4, half), withTiming(1, half)), -1)
    return () => cancelAnimation(opacity)
  }, [active, reduced, opacity])
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }))
  return <Reanimated.View style={style}>{children}</Reanimated.View>
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
  const turn = useSharedValue(open ? 1 : 0)
  useEffect(() => {
    turn.value = reduced
      ? open
        ? 1
        : 0
      : withTiming(open ? 1 : 0, { duration: 200, easing: ReEasing.out(ReEasing.quad) })
  }, [open, reduced, turn])
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 90}deg` }] }))
  return (
    <Reanimated.View style={style}>
      <ChevronRight size={size} color={color} />
    </Reanimated.View>
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
  const progress = useSharedValue(visible ? 1 : 0)
  useEffect(() => {
    if (visible) setMounted(true)
    progress.value = withTiming(
      visible ? 1 : 0,
      { duration: reduceMotion ? 0 : visible ? 180 : 140, easing: ReEasing.out(ReEasing.quad) },
      (finished) => {
        if (finished && !visible) scheduleOnRN(setMounted, false)
      },
    )
  }, [visible, progress])
  const animated = useAnimatedStyle(() => ({
    ...(fade ? { opacity: progress.value } : {}),
    transform: [{ scale: interpolate(progress.value, [0, 1], [fade ? 0.92 : 0.01, 1]) }],
  }))
  if (!mounted) return null
  return (
    <Reanimated.View pointerEvents={visible ? 'box-none' : 'none'} style={[style, animated]}>
      {children}
    </Reanimated.View>
  )
}

/**
 * A floating button that swells a little under a held thumb and settles back on release, on the UI thread. Only the
 * drawn content scales: the Pressable around it keeps its frame, so the New Architecture never misreads the touch.
 */
export function PressGrow({ pressed, children }: { pressed: boolean; children: ReactNode }) {
  const reduced = useReducedMotion()
  const scale = useSharedValue(1)
  useEffect(() => {
    scale.value = withTiming(pressed && !reduced ? 1.18 : 1, {
      duration: pressed ? 160 : 200,
      easing: ReEasing.out(ReEasing.cubic),
    })
  }, [pressed, reduced, scale])
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  return <Reanimated.View style={style}>{children}</Reanimated.View>
}
