import { useEffect } from 'react'
import { View } from 'react-native'
import Reanimated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react-native'
import { Glass } from './Glass'
import { useTheme } from '../theme'
import { gestureOverlayPosition, type Direction, type TerminalGestureState } from '../runtime/terminalGesture'

export type GestureDisplay = Pick<TerminalGestureState, 'active' | 'direction' | 'speed' | 'x' | 'y'>
const SIZE = 112
/** One arrow key of the pad; four sit around the centre like a keyboard's arrow cluster. */
const KEY = 30
const GAP = 4
const CENTER = (SIZE - KEY) / 2
const keys: Record<Direction, { left: number; top: number }> = {
  up: { left: CENTER, top: CENTER - KEY - GAP },
  down: { left: CENTER, top: CENTER + KEY + GAP },
  left: { left: CENTER - KEY - GAP, top: CENTER },
  right: { left: CENTER + KEY + GAP, top: CENTER },
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
 * The cursor pad shown while a held finger moves the terminal's cursor: four keycaps around a centre dot, fixed on the
 * right edge. The key being sent lights in the accent and stacks more chevrons as the cursor speeds up, so how far the
 * finger has travelled reads at a glance without following it.
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
    opacity: interpolate(strength.value, [0, 1], [0.6, 1]),
    transform: [{ scale: interpolate(strength.value, [0, 1], [1, 1.12]) }],
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
            left: (KEY - 18) / 2 + (vertical ? 0 : offset),
            top: (KEY - 18) / 2 + (vertical ? offset : 0),
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
      <Glass radius={30} style={{ width: SIZE, height: SIZE, borderWidth: 0.5, borderColor: c.lineStrong }}>
        <View
          style={{
            position: 'absolute',
            left: SIZE / 2 - 3,
            top: SIZE / 2 - 3,
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: state.direction ? c.accent : c.lineStrong,
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
                  width: KEY,
                  height: KEY,
                  borderRadius: 9,
                  backgroundColor: c.accent,
                },
                lit,
              ]}
            >
              {glyphs(direction, '#ffffff', level)}
            </Reanimated.View>
          ) : (
            <View
              key={direction}
              style={{
                position: 'absolute',
                ...keys[direction],
                width: KEY,
                height: KEY,
                borderRadius: 9,
                backgroundColor: c.fill,
              }}
            >
              {glyphs(direction, c.muted, 1)}
            </View>
          )
        })}
      </Glass>
    </View>
  )
}
