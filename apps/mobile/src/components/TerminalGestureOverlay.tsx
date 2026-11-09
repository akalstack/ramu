import { useEffect } from 'react'
import { View } from 'react-native'
import Reanimated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from 'lucide-react-native'
import { Glass } from './Glass'
import { useTheme } from '../theme'
import { gestureOverlayPosition, type Direction, type TerminalGestureState } from '../runtime/terminalGesture'

export type GestureDisplay = Pick<TerminalGestureState, 'active' | 'direction' | 'speed' | 'x' | 'y'>
const SIZE = 112
const BLUE = '#0a84ff'
const positions = {
  up: { left: 40, top: 6 },
  down: { left: 40, top: 70 },
  left: { left: 8, top: 38 },
  right: { left: 72, top: 38 },
} as const
const arrows = { up: ArrowUp, down: ArrowDown, left: ArrowLeft, right: ArrowRight }
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
    // Retarget from the current presentation value: dragging back drains the blue
    // immediately, rather than waiting for the next key-repeat cycle to finish.
    strength.value = withTiming(speed, { duration: 80, easing: Easing.out(Easing.quad) })
  }, [speed, strength])
  const along = state?.direction === 'up' || state?.direction === 'down' ? 'height' : 'width'
  // On the UI thread: a drag keeps JavaScript busy sending keys, which made the fill lag behind the finger.
  const fill = useAnimatedStyle(() => ({ [along]: interpolate(strength.value, [0, 1], [9, 32]) }))
  if (!state?.active) return null
  const level = state.speed < 0.34 ? 1 : state.speed < 0.67 ? 2 : 3
  const glyph = (direction: Direction, color: string, multiple: boolean) => {
    const I = multiple ? chevrons[direction] : arrows[direction]
    const count = multiple ? level : 1
    return Array.from({ length: count }, (_, i) => {
      const offset = (i - (count - 1) / 2) * 6
      return (
        <I
          key={i}
          size={22}
          strokeWidth={2}
          color={color}
          style={{
            position: 'absolute',
            left: 5 + (direction === 'left' || direction === 'right' ? offset : 0),
            top: 5 + (direction === 'up' || direction === 'down' ? offset : 0),
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
      <Glass radius={24} style={{ width: SIZE, height: SIZE, borderWidth: 0.5, borderColor: c.lineStrong }}>
        <View
          style={{
            position: 'absolute',
            left: 54,
            top: 52,
            width: 4,
            height: 4,
            borderRadius: 2,
            backgroundColor: state.direction ? BLUE : c.lineStrong,
          }}
        />
        {(Object.keys(positions) as Direction[]).map((direction) => {
          const selected = direction === state.direction
          const vertical = direction === 'up' || direction === 'down'
          return (
            <View key={direction} style={{ position: 'absolute', ...positions[direction], width: 32, height: 32 }}>
              {glyph(direction, selected ? c.text : c.muted, selected && level > 1)}
              {selected ? (
                // Fill follows the selected arrow's axis, growing outward from its tail.
                <Reanimated.View
                  style={[
                    {
                      position: 'absolute',
                      overflow: 'hidden',
                      ...(vertical
                        ? { left: 0, width: 32, ...(direction === 'up' ? { bottom: 0 } : { top: 0 }) }
                        : { top: 0, height: 32, ...(direction === 'left' ? { right: 0 } : { left: 0 }) }),
                    },
                    fill,
                  ]}
                >
                  <View
                    style={{
                      position: 'absolute',
                      width: 32,
                      height: 32,
                      ...(direction === 'up'
                        ? { bottom: 0 }
                        : direction === 'left'
                          ? { right: 0 }
                          : { top: 0, left: 0 }),
                    }}
                  >
                    {glyph(direction, BLUE, level > 1)}
                  </View>
                </Reanimated.View>
              ) : null}
            </View>
          )
        })}
      </Glass>
    </View>
  )
}
