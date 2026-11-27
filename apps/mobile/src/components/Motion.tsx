import { CHAT_MOTION, SENT_MOTION, TOOL_MOTION } from '@ramu/shared/chat/presentation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, LayoutAnimation, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import Reanimated, {
  cancelAnimation,
  Easing as ReEasing,
  Extrapolation,
  interpolate,
  makeMutable,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { font } from '../theme'
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

/**
 * One animation for every mark of a kind, started by its first user and stopped with its last, so marks that appeared
 * at different moments move together.
 */
function sharedLoop(start: (value: SharedValue<number>) => void) {
  const value = makeMutable(0)
  let users = 0
  return {
    value,
    useRunning(active: boolean) {
      useEffect(() => {
        if (!active) return
        if (users++ === 0) start(value)
        return () => {
          if (--users > 0) return
          cancelAnimation(value)
          value.value = 0
        }
      }, [active])
    },
  }
}

/** The shimmer's pass, 0 to 1: the highlight crosses the label in the first half and is off its end in the second. */
const sweep = sharedLoop((value) => {
  value.value = withRepeat(withTiming(1, { duration: TOOL_MOTION.sweepMs, easing: ReEasing.linear }), -1, false)
})

/**
 * Bright copies of the label in clipped bands centred on the highlight, outermost first. Stacked, they rise from the
 * muted label to full text colour and back, as the desktop's gradient does across 40% of the label each side.
 */
const SHIMMER_BANDS = [
  { span: 0.8, opacity: 0.35 },
  { span: 0.53, opacity: 0.5 },
  { span: 0.27, opacity: 1 },
] as const

/**
 * The desktop's working shimmer: a soft highlight sweeps the muted label left to right every 2.2 s, on one clock for
 * every label. Only the bands move, by transform, so it costs the same however long the label is.
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
  const [width, setWidth] = useState(0)
  sweep.useRunning(!reduced)
  const textStyle = [{ fontVariant: ['tabular-nums' as const] }, style]
  return (
    <View style={{ minWidth: 0 }}>
      <T
        size={size}
        tone="muted"
        numberOfLines={1}
        style={textStyle}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {children}
      </T>
      {!reduced && width > 0
        ? SHIMMER_BANDS.map((band) => (
            <ShimmerBand key={band.span} span={band.span * width} opacity={band.opacity} width={width}>
              <T size={size} numberOfLines={1} style={textStyle}>
                {children}
              </T>
            </ShimmerBand>
          ))
        : null}
    </View>
  )
}

/** A window `span` wide that follows the highlight, showing the bright copy at the same place as the label under it. */
function ShimmerBand({
  span,
  opacity,
  width,
  children,
}: {
  span: number
  opacity: number
  width: number
  children: ReactNode
}) {
  const left = (pass: number) => {
    'worklet'
    return pass * 2 * width - span / 2
  }
  const band = useAnimatedStyle(() => ({ transform: [{ translateX: left(sweep.value.value) }] }))
  const content = useAnimatedStyle(() => ({ transform: [{ translateX: -left(sweep.value.value) }] }))
  return (
    <Reanimated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, width: span, overflow: 'hidden', opacity }, band]}
    >
      <Reanimated.View style={[{ position: 'absolute', top: 0, left: 0, width }, content]}>{children}</Reanimated.View>
    </Reanimated.View>
  )
}

/**
 * A tool's label: muted text, with a shimmer while the tool runs past a short delay, so a command that finishes at once
 * never flashes it. A finished tool reads as done without a highlight: a wipe on finishing would streak across rows the
 * list has just reused, before their width is known.
 */
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
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => setSettled(true), TOOL_MOTION.shimmerDelayMs)
    return () => {
      clearTimeout(timer)
      setSettled(false)
    }
  }, [active])
  // The shimmer draws the same muted label under its highlight, so the row does not move when it starts or stops.
  return active && settled && !reduced ? (
    <Shimmer size={size}>{children}</Shimmer>
  ) : (
    <T size={size} tone="muted" numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
      {children}
    </T>
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

const SENT_MS = SENT_MOTION.durationMs
/** When each sent message began rising, so the host's copy that replaces it mid-way carries on instead of restarting. */
const sentStarts = new Map<string, number>()

/**
 * A message you just sent rises from the composer into its place, as in WhatsApp: it starts lower and a little smaller,
 * grows from its bottom-right corner, and settles. Only the drawing moves, never the layout, so the list's measured
 * sizes and its scroll position are untouched. `start` begins the rise; a row with the same `identity` mounted while it
 * runs (the host's copy of the message) continues it.
 */
export function SentArrive({ identity, start, children }: { identity: string; start: boolean; children: ReactNode }) {
  const reduced = useReducedMotion()
  const [from] = useState(() => {
    if (reduced) return 1
    const now = Date.now()
    if (start && !sentStarts.has(identity)) sentStarts.set(identity, now)
    const began = sentStarts.get(identity)
    return began === undefined ? 1 : Math.min(1, (now - began) / SENT_MS)
  })
  const progress = useSharedValue(from)
  useEffect(() => {
    if (from >= 1) return
    progress.value = withTiming(1, { duration: SENT_MS * (1 - from), easing: ReEasing.bezier(...SENT_MOTION.easing) })
    const forget = setTimeout(() => sentStarts.delete(identity), SENT_MS * 3)
    return () => {
      cancelAnimation(progress)
      clearTimeout(forget)
    }
  }, [from, identity, progress])
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, SENT_MOTION.opaqueAt], [0, 1], Extrapolation.CLAMP),
    transformOrigin: 'right bottom',
    transform: [
      { translateY: (1 - progress.value) * SENT_MOTION.rise },
      { scale: interpolate(progress.value, [0, 1], [SENT_MOTION.scale, 1], Extrapolation.CLAMP) },
    ],
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

/** The working dot's breath, 0 to 1: the desktop's 1.6 s from full to a third and back. */
const breath = sharedLoop((value) => {
  const half = { duration: 800, easing: ReEasing.inOut(ReEasing.sin) }
  value.value = withRepeat(withSequence(withTiming(1, half), withTiming(0, half)), -1)
})

/** A soft breathing pulse while `active` (a tool still running), settling back to full opacity when it stops. */
export function Breathe({ active, children }: { active: boolean; children: ReactNode }) {
  const reduced = useReducedMotion()
  const on = active && !reduced
  breath.useRunning(on)
  // How much of the shared breath shows: eases in and out so a mark that stops does not snap to full.
  const depth = useSharedValue(on ? 1 : 0)
  useEffect(() => {
    depth.value = withTiming(on ? 1 : 0, { duration: reduced ? 0 : 220, easing: ReEasing.out(ReEasing.quad) })
  }, [on, reduced, depth])
  const style = useAnimatedStyle(() => ({ opacity: 1 - 0.65 * breath.value.value * depth.value }))
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
