import { useMemo, useRef, useState } from 'react'
import { Animated, PanResponder, View } from 'react-native'
import { radius, useTheme } from '../theme'
import { tap } from './ui'

const THUMB = 26
const TRACK = 6

/**
 * The desktop's step slider: a handful of fixed positions, the thumb snapping to each. `onPreview` follows the finger
 * (so a label can show the step under it); `onCommit` fires once on release, as the desktop applies a step on release.
 */
export function StepSlider({
  count,
  index,
  disabled,
  onPreview,
  onCommit,
  label,
}: {
  count: number
  index: number
  disabled?: boolean
  onPreview?: (index: number) => void
  onCommit: (index: number) => void
  label: string
}) {
  const { c } = useTheme()
  const [width, setWidth] = useState(0)
  const [drag, setDrag] = useState<number | null>(null)
  const state = useRef({ width: 0, count, index, last: -1, startX: 0 })
  state.current.width = width
  state.current.count = count
  state.current.index = index
  const at = (x: number) => {
    const { width: w, count: n } = state.current
    return n < 2 || w <= THUMB ? 0 : Math.min(n - 1, Math.max(0, Math.round(((x - THUMB / 2) / (w - THUMB)) * (n - 1))))
  }
  const pan = useMemo(() => {
    const finish = () => {
      const i = state.current.last
      state.current.last = -1
      setDrag(null)
      if (i >= 0 && i !== state.current.index) onCommit(i)
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled && state.current.count > 1,
      onStartShouldSetPanResponderCapture: () => !disabled && state.current.count > 1,
      onMoveShouldSetPanResponder: () => !disabled && state.current.count > 1,
      onMoveShouldSetPanResponderCapture: () => !disabled && state.current.count > 1,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        // Every child ignores touches, so locationX is on the track. Moves add the gesture's own distance to it: a
        // window position measured once would be stale inside a sheet that was still sliding in.
        state.current.startX = event.nativeEvent.locationX
        const i = at(state.current.startX)
        state.current.last = i
        setDrag(i)
        onPreview?.(i)
        tap()
      },
      onPanResponderMove: (_event, gesture) => {
        const i = at(state.current.startX + gesture.dx)
        if (i !== state.current.last) {
          state.current.last = i
          setDrag(i)
          onPreview?.(i)
          tap()
        }
      },
      onPanResponderRelease: () => finish(),
      // A sheet or scroll view may take the touch over mid-drag; keep the step the finger had reached.
      onPanResponderTerminate: () => finish(),
    })
  }, [disabled, onPreview, onCommit])
  const shown = drag ?? index
  const fraction = count > 1 && shown >= 0 ? shown / (count - 1) : 0
  const left = width > THUMB ? fraction * (width - THUMB) : 0
  const ticks = Array.from({ length: count }, (_, i) => i)
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: Math.max(1, count - 1), now: Math.max(0, shown) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        const next =
          event.nativeEvent.actionName === 'increment' ? Math.min(count - 1, index + 1) : Math.max(0, index - 1)
        if (next !== index) onCommit(next)
      }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ height: 40, justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}
      {...pan.panHandlers}
    >
      <View
        pointerEvents="none"
        style={{ height: TRACK, borderRadius: radius.full, backgroundColor: c.fill, marginHorizontal: THUMB / 2 }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: THUMB / 2,
          width: Math.max(0, left),
          height: TRACK,
          borderRadius: radius.full,
          backgroundColor: c.accent,
        }}
      />
      {ticks.map((i) => (
        <View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: count > 1 && width > THUMB ? THUMB / 2 + (i / (count - 1)) * (width - THUMB) - 2 : THUMB / 2 - 2,
            width: 4,
            height: 4,
            borderRadius: 2,
            backgroundColor: i <= shown ? c.primaryInk : c.placeholder,
            opacity: 0.7,
          }}
        />
      ))}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left,
          width: THUMB,
          height: THUMB,
          borderRadius: THUMB / 2,
          transform: [{ scale: drag === null ? 1 : 1.15 }],
          backgroundColor: c.text,
          shadowColor: '#000',
          shadowOpacity: 0.3,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 1 },
          elevation: 3,
        }}
      />
    </View>
  )
}
