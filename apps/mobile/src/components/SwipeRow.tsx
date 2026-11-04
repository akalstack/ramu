import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Animated, Easing, PanResponder, Pressable } from 'react-native'
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
  // The finger's offset: negative while the row is pulled left. JS-driven, since the stretching action is layout.
  const x = useRef(new Animated.Value(0)).current
  const height = useRef(new Animated.Value(0)).current
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
    Animated.spring(x, {
      toValue: isOpen ? -state.current.width : 0,
      useNativeDriver: false,
      bounciness: 0,
      speed: 18,
    }).start()
  }
  const commit = (action: SwipeAction) => {
    tap()
    state.current.open = false
    setOpen(false)
    if (!action.removes) {
      Animated.timing(x, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start()
      action.onPress()
      return
    }
    // Off to the left, then the gap closes; the list drops the row once it has no height, so nothing jumps.
    setLeaving(true)
    Animated.sequence([
      Animated.timing(x, {
        toValue: -(state.current.rowWidth || 400),
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(height, { toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
    ]).start(() => {
      action.onPress()
      // The list normally drops the row now. If it stays (the host refused, or is offline), bring it back.
      restore.current = setTimeout(() => {
        setLeaving(false)
        x.setValue(0)
      }, 1500)
    })
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
            x.setValue(Math.max(next, -(state.current.rowWidth || Infinity)))
            return
          }
          state.current.armed = false
          // Past either end the row resists instead of stopping dead.
          x.setValue(
            next > 0
              ? next / 4
              : next < -state.current.width
                ? -state.current.width + (next + state.current.width) / 4
                : next,
          )
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
  const revealed = x.interpolate({
    inputRange: [-10000, -INSET * 2, 0],
    outputRange: [10000 - INSET * 2, 0, 0],
    extrapolate: 'clamp',
  })
  const beyond = x.interpolate({
    inputRange: [-10000, -width, 0],
    outputRange: [10000 - width, 0, 0],
    extrapolate: 'clamp',
  })
  // The first action, nearest the edge, grows with the pull; the others give it room and fade.
  const firstWidth = Animated.add(BUTTON, beyond)
  const othersFade = x.interpolate({
    inputRange: [-(width + 48), -width, 0],
    outputRange: [0, 1, 1],
    extrapolate: 'clamp',
  })

  return (
    <Animated.View
      style={leaving ? { height, overflow: 'hidden' } : { overflow: 'hidden' }}
      onLayout={(event) => {
        if (!leaving) height.setValue(event.nativeEvent.layout.height)
      }}
    >
      {shown.length ? (
        <Animated.View
          pointerEvents={open ? 'box-none' : 'none'}
          style={{
            position: 'absolute',
            top: INSET,
            bottom: INSET,
            right: INSET,
            width: revealed,
            flexDirection: 'row-reverse',
            gap: GAP,
            overflow: 'hidden',
          }}
        >
          {shown.map((action, index) => (
            <Animated.View
              key={action.label}
              style={{
                width: index === 0 ? firstWidth : BUTTON,
                opacity: index === 0 ? 1 : othersFade,
                flexShrink: index === 0 ? 0 : 1,
              }}
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
            </Animated.View>
          ))}
        </Animated.View>
      ) : null}
      <Animated.View
        {...pan.panHandlers}
        onLayout={(event) => {
          state.current.rowWidth = event.nativeEvent.layout.width
        }}
        style={{
          transform: [{ translateX: x }],
          backgroundColor: background,
          borderRadius: open || leaving ? radius.l : 0,
        }}
      >
        {children}
        {open ? (
          <Pressable
            accessibilityLabel={say('Close actions')}
            onPress={() => settle('closed')}
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
          />
        ) : null}
      </Animated.View>
    </Animated.View>
  )
}
