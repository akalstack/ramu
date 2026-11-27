import { useEffect, useRef } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ClipboardPaste,
  Copy,
  Grid2X2,
  Keyboard,
  KeyboardOff,
  MessageSquarePlus,
  TerminalSquare,
} from 'lucide-react-native'
import { Glass } from './Glass'
import { T, tap, type Icon } from './ui'
import { font, useTheme } from '../theme'
import { DEFAULT_RAIL } from '../runtime/terminalKeys'
import { useSay } from '../i18n'

const railIcons: Record<string, Icon> = { left: ArrowLeft, up: ArrowUp, down: ArrowDown, right: ArrowRight }
/** Keys that repeat while held, as a keyboard's arrows do: moving along a line or through history takes one hold. */
const REPEATS = new Set(['left', 'right', 'up', 'down'])
/** How long a hold waits before repeating, and how often it repeats then, at a keyboard's usual pace. */
const REPEAT_DELAY_MS = 400
const REPEAT_EVERY_MS = 70

/**
 * The terminal's controls, at the bottom where the thumb is: `top`, a row with Back, the workspace switcher (project on
 * top, host and folder below), Copy and Add to chat; `keys`, one slim bar right above the keyboard with the key rail,
 * more keys, paste and the keyboard itself. Shells (select, open, close) live in the tab strip above them.
 */
export function TerminalDock({
  part,
  workspace,
  kind,
  detail,
  computer,
  directory,
  hasShell,
  exited,
  connected,
  keyboardVisible,
  latch,
  onBack,
  onWorkspace,
  onKeyboard,
  onKey,
  onMoreKeys,
  onAddToChat,
  onCopy,
  rail = DEFAULT_RAIL,
}: {
  part: 'top' | 'keys'
  workspace: string
  kind?: 'project' | 'worktree' | 'chat'
  /** The worktree's branch. */ detail?: string
  computer: string
  directory?: string
  hasShell: boolean
  exited?: boolean
  connected: boolean
  keyboardVisible: boolean
  latch: 'ctrl' | 'alt' | null
  onBack(): void
  onWorkspace(): void
  onKeyboard(): void
  onKey(label: string): void
  onMoreKeys?(): void
  /** Puts the rows on screen into the thread's message box; only a thread's own terminal offers it. */
  onAddToChat?(): void
  /** Offers what the terminal can copy: a command with its output, the screen, or text to select. */
  onCopy(): void
  /** The keys on the quiet rail, in order; the person's own choice from the keys sheet. */
  rail?: readonly string[]
}) {
  const say = useSay()
  // A held arrow: the wait before it repeats, then the repeat itself, and whether it repeated (its tap is then spent).
  const hold = useRef<{
    wait?: ReturnType<typeof setTimeout>
    beat?: ReturnType<typeof setInterval>
    repeated: boolean
  }>({ repeated: false })
  const release = () => {
    clearTimeout(hold.current.wait)
    clearInterval(hold.current.beat)
    hold.current.wait = hold.current.beat = undefined
  }
  useEffect(() => release, [])
  const { c } = useTheme()
  const button = (I: Icon, label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        tap()
        onPress()
      }}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? c.pressed : 'transparent',
        opacity: disabled ? 0.35 : 1,
      })}
    >
      <I size={21} strokeWidth={1.8} color={c.text} />
    </Pressable>
  )
  // The folder only earns a place when it says something the top line doesn't (a subfolder, or a worktree directory).
  const same = (a?: string, b?: string) =>
    !!a && !!b && a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '')
  const folder = !hasShell
    ? say('No shell open')
    : same(directory, workspace) || same(directory, detail)
      ? undefined
      : directory
  if (part === 'top')
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 4 }}>
        {button(ChevronLeft, say('Back to thread'), onBack)}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={say('{0} on {1}. {2}. Switch workspace', {
            0: workspace,
            1: computer,
            2: directory ?? say('No shell open'),
          })}
          onPress={() => {
            tap()
            onWorkspace()
          }}
          style={({ pressed }) => ({
            flex: 1,
            minWidth: 0,
            minHeight: 48,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 16,
            backgroundColor: pressed ? c.pressed : c.accentWash,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          })}
        >
          <TerminalSquare size={19} strokeWidth={1.8} color={c.accent} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <T size={font.control} weight="600" numberOfLines={1} style={{ flexShrink: 1 }}>
                {workspace}
              </T>
              {kind ? (
                <View
                  style={{
                    paddingHorizontal: 6,
                    height: 16,
                    borderRadius: 8,
                    backgroundColor: c.fill,
                    justifyContent: 'center',
                  }}
                >
                  <T size={10} weight="600" tone="muted" numberOfLines={1}>
                    {detail
                      ? `${say('Worktree')} · ${detail}`
                      : kind === 'project'
                        ? say('Project')
                        : kind === 'worktree'
                          ? say('Worktree')
                          : say('Thread')}
                  </T>
                </View>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: !connected ? c.warn : exited ? c.muted : c.ok,
                }}
              />
              <T size={11} tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                {!connected
                  ? `${computer} · ${say('Disconnected')}`
                  : exited
                    ? `${computer} · ${say('Session ended')}`
                    : folder
                      ? `${computer} · ${folder}`
                      : computer}
              </T>
            </View>
          </View>
          <ChevronDown size={14} color={c.muted} />
        </Pressable>
        {button(Copy, say('Copy from terminal'), onCopy, !hasShell)}
        {onAddToChat ? button(MessageSquarePlus, say('Add screen to chat'), onAddToChat, !hasShell) : null}
      </View>
    )
  // One row, keyboard up or down, so the terminal above never changes height when the keyboard comes and goes.
  return (
    <Glass radius={18} style={{ paddingHorizontal: 4, borderWidth: 0.5, borderColor: c.lineStrong }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <ScrollView
          style={{ flex: 1 }}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={{ gap: 2 }}
        >
          {rail.map((label) => {
            const I = railIcons[label]
            return (
              <Pressable
                key={label}
                disabled={!connected || exited}
                accessibilityRole="button"
                accessibilityLabel={label === 'paste' ? say('Paste into terminal') : label}
                aria-pressed={label === 'ctrl' || label === 'alt' ? latch === label : undefined}
                accessibilityState={label === 'ctrl' || label === 'alt' ? { selected: latch === label } : undefined}
                onPressIn={() => {
                  if (!REPEATS.has(label)) return
                  release()
                  hold.current.repeated = false
                  hold.current.wait = setTimeout(() => {
                    hold.current.repeated = true
                    onKey(label)
                    hold.current.beat = setInterval(() => onKey(label), REPEAT_EVERY_MS)
                  }, REPEAT_DELAY_MS)
                }}
                onPressOut={release}
                onPress={() => {
                  if (REPEATS.has(label) && hold.current.repeated) return
                  onKey(label)
                }}
                style={({ pressed }) => ({
                  opacity: !connected || exited ? 0.4 : 1,
                  minWidth: 42,
                  height: 44,
                  paddingHorizontal: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 12,
                  backgroundColor: latch === label ? c.primary : pressed ? c.pressed : 'transparent',
                })}
              >
                {I ? (
                  <I size={17} color={c.soft} strokeWidth={1.8} />
                ) : (
                  <T mono size={font.control} weight="500" style={{ color: latch === label ? c.primaryInk : c.soft }}>
                    {label}
                  </T>
                )}
              </Pressable>
            )
          })}
        </ScrollView>
        {onMoreKeys ? button(Grid2X2, say('More terminal keys'), onMoreKeys, !connected || exited) : null}
        {button(ClipboardPaste, say('Paste into terminal'), () => onKey('paste'), !connected || exited)}
        {button(
          keyboardVisible ? KeyboardOff : Keyboard,
          keyboardVisible ? say('Hide terminal keyboard') : say('Show terminal keyboard'),
          onKeyboard,
          !hasShell || !connected || exited,
        )}
      </View>
    </Glass>
  )
}
