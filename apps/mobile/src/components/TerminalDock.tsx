import { Pressable, ScrollView, View } from 'react-native'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronLeft, ClipboardPaste, CircleX, Grid2X2, Keyboard, KeyboardOff, Plus, TerminalSquare } from 'lucide-react-native'
import { Glass } from './Glass'
import { T, tap, type Icon } from './ui'
import { font, useTheme } from '../theme'

const keys: { label: string; icon?: Icon }[] = [
  { label: 'esc' }, { label: 'tab' }, { label: 'ctrl' }, { label: 'alt' },
  { label: '/' }, { label: '|' }, { label: '~' }, { label: '-' },
  { label: 'left', icon: ArrowLeft }, { label: 'up', icon: ArrowUp },
  { label: 'down', icon: ArrowDown }, { label: 'right', icon: ArrowRight },
  { label: '^C' }, { label: '^D' }, { label: '^Z' },
]

/** Terminal-specific bottom console: session navigation and a quiet, scrollable key rail. */
export function TerminalDock({ computer, directory, count, exited, connected, keyboardVisible, latch, busy, onBack, onSessions, onNew, onKeyboard, onKey, onClose, onMoreKeys }: {
  computer: string; directory?: string; count: number; exited?: boolean; connected: boolean; keyboardVisible: boolean; latch: 'ctrl' | 'alt' | null; busy?: boolean
  onBack(): void; onSessions(): void; onNew(): void; onKeyboard(): void; onKey(label: string): void; onClose?(): void; onMoreKeys?(): void
}) {
  const { c } = useTheme()
  const button = (I: Icon, label: string, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={() => { tap(); onPress() }} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.pressed : 'transparent', opacity: disabled ? 0.35 : 1 })}><I size={21} strokeWidth={1.8} color={c.text} /></Pressable>
  return <Glass radius={24} style={{ padding: 6, borderWidth: 0.5, borderColor: c.lineStrong }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {button(ChevronLeft, 'Back to chat', onBack)}
      <View style={{ flex: 1, minWidth: 0, borderRadius: 16, backgroundColor: c.accentWash, flexDirection: 'row', alignItems: 'center' }}><Pressable accessibilityRole="button" accessibilityLabel={`Terminal sessions, ${count}. ${computer}. ${directory ?? 'No shell open'}`} onPress={() => { tap(); onSessions() }} style={({ pressed }) => ({ flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: pressed ? c.pressed : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 8 })}>
        <TerminalSquare size={19} strokeWidth={1.8} color={c.accent} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}><T size={13} weight="600" numberOfLines={1}>{computer}</T><View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: !connected ? c.warn : exited ? c.muted : c.ok }} /><T size={11} tone="muted" numberOfLines={1} style={{ flex: 1 }}>{!connected ? 'Disconnected' : exited ? 'Session ended' : directory ?? 'No shell open'}</T></View></View>
        {count > 1 ? <T size={10} tone="muted" weight="600">{count}</T> : null}
        <ChevronDown size={13} color={c.muted} />
      </Pressable>{count > 0 && onClose ? <Pressable accessibilityRole="button" accessibilityLabel="Close active terminal" onPress={onClose} style={{ width: 36, height: 44, alignItems: 'center', justifyContent: 'center' }}><CircleX size={17} color={c.muted} strokeWidth={1.7} /></Pressable> : null}</View>
      {button(Plus, busy ? 'Opening terminal' : 'New terminal', onNew, !connected || busy)}
      {button(keyboardVisible ? KeyboardOff : Keyboard, keyboardVisible ? 'Hide terminal keyboard' : 'Show terminal keyboard', onKeyboard, count === 0 || !connected || exited)}
    </View>
    {keyboardVisible ? <View style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: 0.5, borderTopColor: c.lineStrong, marginTop: 6, paddingTop: 3 }}><ScrollView style={{ flex: 1 }} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 2 }}>
      {keys.map(({ label, icon: I }) => <Pressable key={label} disabled={!connected || exited} accessibilityRole="button" accessibilityLabel={label === 'paste' ? 'Paste into terminal' : label} aria-pressed={label === 'ctrl' || label === 'alt' ? latch === label : undefined} accessibilityState={label === 'ctrl' || label === 'alt' ? { selected: latch === label } : undefined} onPress={() => onKey(label)} style={({ pressed }) => ({ opacity: !connected || exited ? 0.4 : 1, minWidth: 42, height: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: latch === label ? c.primary : pressed ? c.pressed : 'transparent' })}>{I ? <I size={17} color={c.soft} strokeWidth={1.8} /> : <T mono size={font.control} weight="500" style={{ color: latch === label ? c.primaryInk : c.soft }}>{label}</T>}</Pressable>)}
    </ScrollView>{onMoreKeys ? button(Grid2X2, 'More terminal keys', onMoreKeys, !connected || exited) : null}{button(ClipboardPaste, 'Paste into terminal', () => onKey('paste'), !connected || exited)}</View> : null}
  </Glass>
}
