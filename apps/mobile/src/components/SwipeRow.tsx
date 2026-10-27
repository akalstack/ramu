import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Animated, PanResponder, Pressable, View } from 'react-native'
import { tap } from './ui'
import { useSay } from '../i18n'

export type SwipeAction = {
  icon: ComponentType<{ size?: number; color?: string }>
  label: string
  color: string
  onPress: () => void
}

const BUTTON = 60

/**
 * Swipe left to reveal tappable buttons, as in Mail and Messages. Nothing fires from the gesture itself:
 * the row settles open, the user taps a button (or the row, or swipes back) and it closes again.
 */
export function SwipeRow({
  children,
  actions = [],
  background,
}: {
  children: ReactNode
  actions?: SwipeAction[]
  background: string
}) {
  const say = useSay()
  const x = useRef(new Animated.Value(0)).current
  const width = actions.length * BUTTON
  const [open, setOpen] = useState(false)
  const state = useRef({ width, open: false, start: 0 })
  state.current.width = width
  const settle = (to: 'open' | 'closed') => {
    const isOpen = to === 'open'
    if (isOpen !== state.current.open) tap()
    state.current.open = isOpen
    setOpen(isOpen)
    Animated.spring(x, {
      toValue: isOpen ? -state.current.width : 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 20,
    }).start()
  }
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
        },
        onPanResponderMove: (_, g) => {
          const next = state.current.start + g.dx
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
          settle(g.vx < -0.3 || (g.vx < 0.3 && at < -state.current.width / 2) ? 'open' : 'closed')
        },
        onPanResponderTerminate: () => settle(state.current.open ? 'open' : 'closed'),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [x] by design; the values it reads beyond these are current as of that run
    [x],
  )

  return (
    <View style={{ overflow: 'hidden' }}>
      {width ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            right: 0,
            width,
            flexDirection: 'row',
            backgroundColor: background,
          }}
        >
          {actions.map((action) => (
            <Pressable
              key={action.label}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              onPress={() => {
                tap()
                settle('closed')
                action.onPress()
              }}
              style={({ pressed }) => ({
                width: BUTTON,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              {/* Icon only: a circle plus caption is taller than a compact chat row and got clipped. */}
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  backgroundColor: action.color,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <action.icon size={18} color="#ffffff" />
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX: x }], backgroundColor: background }}>
        {children}
        {open ? (
          <Pressable
            accessibilityLabel={say('Close actions')}
            onPress={() => settle('closed')}
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
          />
        ) : null}
      </Animated.View>
    </View>
  )
}
