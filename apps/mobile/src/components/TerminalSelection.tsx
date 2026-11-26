import { useRef } from 'react'
import { PanResponder, Pressable, View, type PanResponderInstance } from 'react-native'
import { Glass } from './Glass'
import { T, tap } from './ui'
import { font, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import type { TerminalSelectionState } from '../runtime/terminalSelection'

const HANDLE_HIT = 44
const KNOB = 10
const MENU_HEIGHT = 40
const MENU_GAP = 8

/**
 * Handles and a menu for text selected in the phone's terminal, drawn as chat's selection is: a knob above the start and
 * below the end to drag either way, and Copy, Select all and the command's own block in a bar over the selection.
 */
export function TerminalSelection({
  state,
  width,
  height,
  onGrab,
  onMove,
  onCopy,
  onSelectAll,
  onSelectBlock,
}: {
  state: TerminalSelectionState | null
  width: number
  height: number
  /** A handle is picked up, so the other end stays where it is while it moves. */
  onGrab(handle: 'start' | 'end'): void
  onMove(handle: 'start' | 'end', x: number, y: number): void
  onCopy(text: string): void
  onSelectAll(): void
  onSelectBlock(): void
}) {
  const say = useSay()
  const { c } = useTheme()
  const latest = useRef({ state, onGrab, onMove })
  latest.current = { state, onGrab, onMove }
  // Each handle remembers where its line's middle was when the finger landed, and follows the finger from there.
  const handle = (which: 'start' | 'end'): PanResponderInstance => {
    let origin = { x: 0, y: 0 }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const current = latest.current.state
        const point = current?.[which]
        if (!current || !point) return
        origin = { x: point.x, y: point.y + current.lineHeight / 2 }
        latest.current.onGrab(which)
      },
      onPanResponderMove: (_event, gesture) =>
        latest.current.onMove(which, origin.x + gesture.dx, origin.y + gesture.dy),
    })
  }
  const handles = useRef({ start: handle('start'), end: handle('end') }).current
  if (!state) return null
  const knob = (which: 'start' | 'end') => {
    const point = state[which]
    if (!point) return null
    const hitTop = point.y + state.lineHeight / 2 - HANDLE_HIT / 2
    return (
      <View
        key={which}
        {...handles[which].panHandlers}
        accessibilityLabel={which === 'start' ? say('Start of selection') : say('End of selection')}
        style={{
          position: 'absolute',
          left: point.x - HANDLE_HIT / 2,
          top: hitTop,
          width: HANDLE_HIT,
          height: HANDLE_HIT,
        }}
      >
        {/* The bar covers the selected row exactly; the knob sits above the start and below the end. */}
        <View
          style={{
            position: 'absolute',
            left: HANDLE_HIT / 2 - KNOB / 2,
            top: point.y - hitTop - (which === 'start' ? KNOB : 0),
            alignItems: 'center',
            width: KNOB,
          }}
        >
          {which === 'start' && (
            <View style={{ width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: c.accent }} />
          )}
          <View style={{ width: 2, height: state.lineHeight, backgroundColor: c.accent }} />
          {which === 'end' && (
            <View style={{ width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: c.accent }} />
          )}
        </View>
      </View>
    )
  }
  const actions: [string, () => void][] = [
    [say('Copy'), () => onCopy(state.text)],
    [say('Select all'), onSelectAll],
    ...(state.block ? ([[say('Select command'), onSelectBlock]] as [string, () => void][]) : []),
  ]
  // Over the selection, or under it when there is no room above; centred on it and kept on screen.
  const anchorTop = state.start?.y ?? state.end?.y ?? 0
  const anchorBottom = (state.end?.y ?? state.start?.y ?? 0) + state.lineHeight
  const above = anchorTop - MENU_GAP - MENU_HEIGHT - KNOB
  const top = above >= 0 ? above : Math.min(height - MENU_HEIGHT, anchorBottom + MENU_GAP + KNOB)
  const centre = ((state.start?.x ?? 0) + (state.end?.x ?? width)) / 2
  const menuWidth = Math.min(width - space.l * 2, actions.length * 110)
  const left = Math.max(space.l, Math.min(width - space.l - menuWidth, centre - menuWidth / 2))
  return (
    <>
      {knob('start')}
      {knob('end')}
      <Glass
        radius={MENU_HEIGHT / 2}
        style={{
          position: 'absolute',
          top,
          left,
          width: menuWidth,
          height: MENU_HEIGHT,
          flexDirection: 'row',
          borderWidth: 0.5,
          borderColor: c.lineStrong,
          overflow: 'hidden',
        }}
      >
        {actions.map(([label, run], index) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            onPress={() => {
              tap()
              run()
            }}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: space.s,
              backgroundColor: pressed ? c.pressed : 'transparent',
              borderLeftWidth: index ? 0.5 : 0,
              borderLeftColor: c.lineStrong,
            })}
          >
            <T size={font.control} weight="500" numberOfLines={1}>
              {label}
            </T>
          </Pressable>
        ))}
      </Glass>
    </>
  )
}
