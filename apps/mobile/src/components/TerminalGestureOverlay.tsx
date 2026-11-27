import { useEffect } from 'react'
import { View } from 'react-native'
import Reanimated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react-native'
import { Glass } from './Glass'
import { useTheme } from '../theme'
import { gestureOverlayPosition, type Direction, type TerminalGestureState } from '../runtime/terminalGesture'

export type GestureDisplay = Pick<TerminalGestureState, 'active' | 'direction' | 'speed' | 'x' | 'y'>
const SIZE = 112
/** Where each direction sits: on a ring around the centre, like the arrows of a remote's round pad. */
const SPOT = 34
const RING = 31
const CENTER = (SIZE - SPOT) / 2
const keys: Record<Direction, { left: number; top: number }> = {
  up: { left: CENTER, top: CENTER - RING },
  down: { left: CENTER, top: CENTER + RING },
  left: { left: CENTER - RING, top: CENTER },
  right: { left: CENTER + RING, top: CENTER },
}
const chevrons = { up: ChevronUp, down: ChevronDown, left: ChevronLeft, right: ChevronRight }

export function readGesture(value: Record<string, unknown>): GestureDisplay | null {
  if (!value.active) return null
  const direction =
    value.direction === null || ['up', 'down', 'left', 'right'].includes(String(value.direction))
      ? (value.direction as Direction | null)
      : null
  if (![value.speed, value.x, value.y].every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  return {
    active: true,
    direction,
    speed: Math.max(0, Math.min(1, value.speed as number)),
    x: value.x as number,
    y: value.y as number,
  }
}

/**
 * The cursor pad shown while a held finger moves the terminal's cursor: a round glass pad with an arrow on each side,
 * fixed on the right edge. The arrow being sent sits on an accent disc that brightens and stacks more chevrons as the
 * cursor speeds up, so how far the finger has travelled reads at a glance without following it. On Android, which has
 * no glass, it is a raised surface over the terminal.
 */
export function TerminalGestureOverlay({
  state,
  width,
  height,
}: {
  state: GestureDisplay | null
  width: number
  height: number
}) {
  const { c } = useTheme()
  const strength = useSharedValue(0)
  const speed = state?.direction ? state.speed : 0
  useEffect(() => {
    // Retarget from the current presentation value: easing off drains the key at once rather than after a key repeat.
    strength.value = withTiming(speed, { duration: 80, easing: Easing.out(Easing.quad) })
  }, [speed, strength])
  // On the UI thread: a drag keeps JavaScript busy sending keys, which made the key lag behind the finger.
  const lit = useAnimatedStyle(() => ({
    opacity: interpolate(strength.value, [0, 1], [0.7, 1]),
    transform: [{ scale: interpolate(strength.value, [0, 1], [0.92, 1.08]) }],
  }))
  if (!state?.active) return null
  const level = state.speed < 0.34 ? 1 : state.speed < 0.67 ? 2 : 3
  const glyphs = (direction: Direction, color: string, count: number) => {
    const I = chevrons[direction]
    const vertical = direction === 'up' || direction === 'down'
    return Array.from({ length: count }, (_, i) => {
      const offset = (i - (count - 1) / 2) * 5
      return (
        <I
          key={i}
          size={18}
          strokeWidth={2.4}
          color={color}
          style={{
            position: 'absolute',
            left: (SPOT - 18) / 2 + (vertical ? 0 : offset),
            top: (SPOT - 18) / 2 + (vertical ? offset : 0),
          }}
        />
      )
    })
  }
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: 'absolute',
        ...gestureOverlayPosition(state.x, state.y, width, height, SIZE),
        width: SIZE,
        height: SIZE,
      }}
    >
      <Glass radius={SIZE / 2} floating style={{ width: SIZE, height: SIZE }}>
        <View
          style={{
            position: 'absolute',
            left: SIZE / 2 - 3,
            top: SIZE / 2 - 3,
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: state.direction ? c.accent : c.muted,
            opacity: state.direction ? 1 : 0.5,
          }}
        />
        {(Object.keys(keys) as Direction[]).map((direction) => {
          const selected = direction === state.direction
          return selected ? (
            <Reanimated.View
              key={direction}
              style={[
                {
                  position: 'absolute',
                  ...keys[direction],
                  width: SPOT,
                  height: SPOT,
                  borderRadius: SPOT / 2,
                  backgroundColor: c.accent,
                },
                lit,
              ]}
            >
              {glyphs(direction, '#ffffff', level)}
            </Reanimated.View>
          ) : (
            <View key={direction} style={{ position: 'absolute', ...keys[direction], width: SPOT, height: SPOT }}>
              {glyphs(direction, c.soft, 1)}
            </View>
          )
        })}
      </Glass>
    </View>
  )
}
