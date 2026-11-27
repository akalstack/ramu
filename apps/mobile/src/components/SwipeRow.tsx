import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { PanResponder, Pressable } from 'react-native'
import Reanimated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { tap } from './ui'
import { useSay } from '../i18n'
import { radius } from '../theme'

export type SwipeAction = {
  icon: ComponentType<{ size?: number; color?: string }>
  label: string
  color: string
  onPress: () => void
  /** The action takes the row out of this list (archive, done): a full swipe slides it away and closes the gap. */
  removes?: boolean
}

const BUTTON = 64
const GAP = 6
const INSET = 6

/**
 * Swipe left, as in Gmail: the row slides over rounded actions behind it. A short swipe settles open on them (up to
 * three) to tap; pulling well past them stretches the first action across the row, its icon riding at the edge, and
 * letting go runs it. An action that removes the row slides it off to the left and the rows below close the gap.
 */
export function SwipeRow({
  children,
  actions = [],
  background,
  fullSwipe = false,
}: {
  children: ReactNode
  actions?: SwipeAction[]
  background: string
  fullSwipe?: boolean
}) {
  const say = useSay()
  const shown = actions.slice(0, 3)
  // The finger's offset: negative while the row is pulled left. On the UI thread, stretching action included, so the
  // row keeps up with the finger and settles smoothly while JavaScript is busy.
  const x = useSharedValue(0)
  const height = useSharedValue(0)
  const width = shown.length ? shown.length * BUTTON + (shown.length - 1) * GAP + INSET * 2 : 0
  const [open, setOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const state = useRef({ width, open: false, start: 0, rowWidth: 0, armed: false, full: fullSwipe, first: shown[0] })
  state.current.width = width
  state.current.full = fullSwipe
  state.current.first = shown[0]
  // Far enough that it cannot happen by accident: past the buttons, and about halfway across the row.
  const commitAt = () => Math.max(state.current.width + 48, state.current.rowWidth * 0.5)
  const settle = (to: 'open' | 'closed') => {
    const isOpen = to === 'open'
    if (isOpen !== state.current.open) tap()
    state.current.open = isOpen
    setOpen(isOpen)
    x.value = withSpring(isOpen ? -state.current.width : 0, { damping: 30, stiffness: 320, overshootClamping: true })
  }
  const commit = (action: SwipeAction) => {
    tap()
    state.current.open = false
    setOpen(false)
    if (!action.removes) {
      x.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) })
      action.onPress()
      return
    }
    // Off to the left, then the gap closes; the list drops the row once it has no height, so nothing jumps.
    setLeaving(true)
    const gone = () => {
      action.onPress()
      // The list normally drops the row now. If it stays (the host refused, or is offline), bring it back.
      restore.current = setTimeout(() => {
        setLeaving(false)
        x.value = 0
      }, 1500)
    }
    x.value = withTiming(
      -(state.current.rowWidth || 400),
      { duration: 180, easing: Easing.in(Easing.quad) },
      (finished) => {
        if (!finished) return
        height.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) }, (done) => {
          if (done) scheduleOnRN(gone)
        })
      },
    )
  }
  const restore = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (restore.current) clearTimeout(restore.current)
    },
    [],
  )
  useEffect(() => {
    if (!width && state.current.open) settle('closed')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [width] by design; the values it reads beyond these are current as of that run
  }, [width])
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          state.current.width > 0 && Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          state.current.start = state.current.open ? -state.current.width : 0
          state.current.armed = false
        },
        onPanResponderMove: (_, g) => {
          const next = state.current.start + g.dx
          const full = state.current.full && state.current.first
          if (full && next < -state.current.width) {
            // The row follows the finger toward the full swipe; a tap marks the point where letting go runs it.
            const armed = next < -commitAt()
            if (armed !== state.current.armed) {
              state.current.armed = armed
              tap()
            }
            x.value = Math.max(next, -(state.current.rowWidth || Infinity))
            return
          }
          state.current.armed = false
          // Past either end the row resists instead of stopping dead.
          x.value =
            next > 0
              ? next / 4
              : next < -state.current.width
                ? -state.current.width + (next + state.current.width) / 4
                : next
        },
        onPanResponderRelease: (_, g) => {
          const at = state.current.start + g.dx
          const first = state.current.first
          if (state.current.full && first && (at < -commitAt() || (at < -state.current.width && g.vx < -1.2)))
            return commit(first)
          settle(g.vx < -0.3 || (g.vx < 0.3 && at < -state.current.width / 2) ? 'open' : 'closed')
        },
        onPanResponderTerminate: () => settle(state.current.open ? 'open' : 'closed'),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [x] by design; the values it reads beyond these are current as of that run
    [x],
  )
  // The revealed width behind the row, and how far past the buttons the finger has pulled (0 until it does).
  const revealedStyle = useAnimatedStyle(
    () => ({ width: interpolate(x.value, [-10000, -INSET * 2, 0], [10000 - INSET * 2, 0, 0], Extrapolation.CLAMP) }),
    [],
  )
  // The first action, nearest the edge, grows with the pull; the others give it room and fade.
  const firstStyle = useAnimatedStyle(
    () => ({ width: BUTTON + interpolate(x.value, [-10000, -width, 0], [10000 - width, 0, 0], Extrapolation.CLAMP) }),
    [width],
  )
  const othersStyle = useAnimatedStyle(
    () => ({ opacity: interpolate(x.value, [-(width + 48), -width, 0], [0, 1, 1], Extrapolation.CLAMP) }),
    [width],
  )
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }), [])
  const leavingStyle = useAnimatedStyle(() => (leaving ? { height: height.value } : {}), [leaving])

  return (
    <Reanimated.View
      style={[{ overflow: 'hidden' }, leavingStyle]}
      onLayout={(event) => {
        if (!leaving) height.value = event.nativeEvent.layout.height
      }}
    >
      {shown.length ? (
        <Reanimated.View
          pointerEvents={open ? 'box-none' : 'none'}
          style={[
            {
              position: 'absolute',
              top: INSET,
              bottom: INSET,
              right: INSET,
              flexDirection: 'row-reverse',
              gap: GAP,
              overflow: 'hidden',
            },
            revealedStyle,
          ]}
        >
          {shown.map((action, index) => (
            <Reanimated.View
              key={action.label}
              style={[{ width: BUTTON, flexShrink: index === 0 ? 0 : 1 }, index === 0 ? firstStyle : othersStyle]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={action.label}
                onPress={() => commit(action)}
                style={({ pressed }) => ({
                  flex: 1,
                  borderRadius: radius.l,
                  backgroundColor: action.color,
                  // The icon rides at the edge the row is leaving, as Gmail's does while its pill stretches.
                  alignItems: index === 0 ? 'flex-start' : 'center',
                  paddingLeft: index === 0 ? (BUTTON - 20) / 2 : 0,
                  justifyContent: 'center',
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <action.icon size={20} color="#ffffff" />
              </Pressable>
            </Reanimated.View>
          ))}
        </Reanimated.View>
      ) : null}
      <Reanimated.View
        {...pan.panHandlers}
        onLayout={(event) => {
          state.current.rowWidth = event.nativeEvent.layout.width
        }}
        style={[{ backgroundColor: background, borderRadius: open || leaving ? radius.l : 0 }, rowStyle]}
      >
        {children}
        {open ? (
          <Pressable
            accessibilityLabel={say('Close actions')}
            onPress={() => settle('closed')}
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
          />
        ) : null}
      </Reanimated.View>
    </Reanimated.View>
  )
}
