import { useImperativeHandle, useRef, useState, type ComponentRef, type ReactNode, type Ref } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View, useWindowDimensions } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'
import type { BrowserFieldFocus } from '@ramu/shared/browserBridge'
import { KEYBOARD_SENTINEL, keyboardFor, remoteKeys, type RemoteKey } from '../runtime/remoteKeyboard'
import { font, radius, space, useTheme } from '../theme'
import { Glass } from './Glass'
import { T, tap, type Icon } from './ui'

/** Full-screen viewers (browser, computer) share one chrome: close on the left, the page title centred, one action right. */
export function ViewerHeader({
  title,
  subtitle,
  closeLabel,
  onClose,
  right,
}: {
  title: string
  subtitle?: string
  closeLabel: string
  onClose(): void
  right?: ReactNode
}) {
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.m, minHeight: 56 }}
    >
      <ControlPill icon={X} label={closeLabel} onPress={onClose} size={44} />
      <View style={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
        <T accessibilityRole="header" weight="600" size={font.heading} numberOfLines={1}>
          {title}
        </T>
        {subtitle ? (
          <T tone="muted" size={font.caption} numberOfLines={1}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {right ?? <View style={{ width: 44 }} accessibilityElementsHidden importantForAccessibility="no" />}
    </View>
  )
}

/** A round, filled icon control. Icon-only, so the label is required for screen readers. */
export function ControlPill({
  icon: I,
  label,
  onPress,
  disabled,
  size = 40,
  selected,
  badge,
  pillRef,
}: {
  icon: Icon
  label: string
  onPress?(): void
  disabled?: boolean
  size?: number
  selected?: boolean
  /** A small count drawn in place of the icon, as a tab switcher shows its tabs. */
  badge?: string
  pillRef?: Ref<ComponentRef<typeof View>>
}) {
  const { c } = useTheme()
  return (
    <Pressable
      ref={pillRef}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!selected }}
      disabled={disabled}
      hitSlop={4}
      onPress={() => {
        tap()
        onPress?.()
      }}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
        backgroundColor: pressed ? c.pressed : selected ? c.accentSoft : c.fill,
      })}
    >
      {badge ? (
        <View
          style={{
            minWidth: 20,
            height: 20,
            paddingHorizontal: 4,
            borderRadius: 5,
            borderWidth: 1.6,
            borderColor: c.text,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <T size={font.caption - 1} weight="700">
            {badge}
          </T>
        </View>
      ) : (
        <I size={Math.round(size * 0.45)} color={selected ? c.accent : c.text} strokeWidth={1.9} />
      )}
    </Pressable>
  )
}

/** Who drives the screen now, and the one action that changes it. */
export function ControlStrip({
  text,
  tone,
  action,
}: {
  text: string
  tone?: 'muted' | 'warn' | 'accent'
  action?: { title: string; onPress(): void; disabled?: boolean; primary?: boolean }
}) {
  const { c } = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.s,
        paddingLeft: space.l,
        paddingRight: space.s,
        minHeight: 52,
        paddingBottom: space.xs,
      }}
    >
      <T
        accessibilityLiveRegion="polite"
        size={font.control}
        numberOfLines={2}
        style={{ flex: 1, color: tone === 'warn' ? c.warn : tone === 'accent' ? c.accent : c.muted }}
      >
        {text}
      </T>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.title}
          accessibilityState={{ disabled: !!action.disabled }}
          disabled={action.disabled}
          onPress={() => {
            tap()
            action.onPress()
          }}
          style={({ pressed }) => ({
            minHeight: 40,
            paddingHorizontal: space.l,
            borderRadius: radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: action.disabled ? 0.45 : pressed ? 0.8 : 1,
            backgroundColor: action.primary ? c.primary : c.fill,
          })}
        >
          <T weight="600" size={font.control} style={{ color: action.primary ? c.primaryInk : c.text }}>
            {action.title}
          </T>
        </Pressable>
      ) : null}
    </View>
  )
}

/** A message the page or another device is waiting on, shown between the chrome and the screen. */
export function ViewerBanner({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' | 'bad' }) {
  const { c } = useTheme()
  return (
    <View
      accessibilityRole="alert"
      style={{
        marginHorizontal: space.m,
        marginBottom: space.s,
        padding: space.m,
        gap: space.s,
        borderRadius: radius.m,
        backgroundColor: tone === 'bad' ? c.badWash : tone === 'warn' ? c.warnWash : c.fill,
      }}
    >
      {children}
    </View>
  )
}

/** How long the menu takes to fade out before its action may open a sheet. */
const MENU_SETTLE_MS = 350

export type ViewerMenuItem = {
  key: string
  title: string
  icon: Icon
  onPress(): void
  destructive?: boolean
  disabled?: boolean
}

/** Opens a popover anchored under the control that opened it. */
export function useViewerMenu() {
  const anchor = useRef<ComponentRef<typeof View>>(null)
  const [at, setAt] = useState<{ top: number; right: number } | null>(null)
  const { width } = useWindowDimensions()
  const open = () =>
    anchor.current?.measureInWindow((x, y, w, h) => setAt({ top: y + h + 6, right: Math.max(space.s, width - x - w) }))
  return { anchor, at, open, close: () => setAt(null) }
}

/** The overflow menu: glass, icon rows, destructive items in red. Built here so it matches the app and runs in Expo Go. */
export function ViewerMenu({
  at,
  onClose,
  items,
  label,
}: {
  at: { top: number; right: number } | null
  onClose(): void
  items: ViewerMenuItem[]
  label: string
}) {
  const { c } = useTheme()
  return (
    <Modal
      visible={!!at}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      // The computer viewer turns to landscape; the menu must open over it without rotating the app back.
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
    >
      <Pressable accessibilityLabel={label} style={{ flex: 1 }} onPress={onClose}>
        {at ? (
          <Glass
            radius={radius.xl}
            style={{ position: 'absolute', top: at.top, right: at.right, minWidth: 236, maxWidth: 300 }}
          >
            <View accessibilityRole="menu" style={{ paddingVertical: space.s }}>
              {items.map((item) => {
                const tint = item.destructive ? c.bad : c.text
                return (
                  <Pressable
                    key={item.key}
                    accessibilityRole="menuitem"
                    accessibilityLabel={item.title}
                    accessibilityState={{ disabled: !!item.disabled }}
                    disabled={item.disabled}
                    onPress={() => {
                      tap()
                      onClose()
                      // iOS cannot present a sheet or picker while this menu is still fading out.
                      setTimeout(item.onPress, MENU_SETTLE_MS)
                    }}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.m,
                      minHeight: 48,
                      paddingHorizontal: space.l,
                      opacity: item.disabled ? 0.4 : 1,
                      backgroundColor: pressed ? c.pressed : 'transparent',
                    })}
                  >
                    <item.icon size={20} color={tint} strokeWidth={1.8} />
                    <T size={font.body + 1} style={{ color: tint, flexShrink: 1 }} numberOfLines={1}>
                      {item.title}
                    </T>
                  </Pressable>
                )
              })}
            </View>
          </Glass>
        ) : null}
      </Pressable>
    </Modal>
  )
}

export type RemoteKeyboardHandle = {
  /** Raises the phone keyboard for a remote field of this kind. */
  open(kind?: BrowserFieldFocus['kind']): void
  close(): void
  isOpen(): boolean
}

/**
 * The phone's own keyboard, typing into the remote screen. A hidden field receives the keystrokes; each change is sent
 * as text, Backspace or Enter, so autocorrect, emoji and dictation all work without a custom key row.
 */
export function RemoteKeyboard({
  handle,
  label,
  onKeys,
  onFocusChange,
}: {
  handle: Ref<RemoteKeyboardHandle>
  label: string
  onKeys(keys: RemoteKey[]): void
  /** The phone keyboard rose or went away, so a toggle can show its state. */
  onFocusChange?(open: boolean): void
}) {
  const field = useRef<ComponentRef<typeof TextInput>>(null)
  // The field is never empty: deleting the sentinel is how Backspace reaches the remote screen, which works on
  // Android keyboards that send no key event for an empty field. A new object forces the reset to reach the field.
  const [value, setValue] = useState({ text: KEYBOARD_SENTINEL })
  const shadow = useRef(KEYBOARD_SENTINEL)
  const focused = useRef(false)
  const [kind, setKind] = useState<BrowserFieldFocus['kind']>()
  const kindNow = useRef(kind)
  kindNow.current = kind
  const send = useRef(onKeys)
  send.current = onKeys
  const reset = () => {
    shadow.current = KEYBOARD_SENTINEL
    setValue({ text: KEYBOARD_SENTINEL })
  }
  useImperativeHandle(
    handle,
    () => ({
      open: (next) => {
        reset()
        const changed = next !== kindNow.current
        setKind(next)
        // A focused field keeps its old keyboard when only the type changes, so drop focus and raise it again.
        if (changed && focused.current) field.current?.blur()
        setTimeout(() => field.current?.focus(), changed && focused.current ? 60 : 0)
      },
      close: () => field.current?.blur(),
      isOpen: () => focused.current,
    }),
    [],
  )
  const props = keyboardFor(kind)
  return (
    <TextInput
      ref={field}
      accessibilityLabel={label}
      {...props}
      value={value.text}
      autoCorrect={false}
      spellCheck={false}
      autoComplete="off"
      textContentType="none"
      caretHidden
      contextMenuHidden
      submitBehavior={props.multiline ? 'newline' : 'submit'}
      onFocus={() => {
        focused.current = true
        onFocusChange?.(true)
      }}
      onBlur={() => {
        focused.current = false
        onFocusChange?.(false)
      }}
      onChangeText={(next) => {
        const keys = remoteKeys(shadow.current, next)
        // What was typed already lives in the remote page; keep the hidden field short and never empty.
        if (!next.startsWith(KEYBOARD_SENTINEL) || next.length > 400) reset()
        else {
          shadow.current = next
          setValue({ text: next })
        }
        if (keys.length) send.current(keys)
      }}
      onSubmitEditing={() => send.current([{ kind: 'key', key: 'Enter' }])}
      style={{ position: 'absolute', left: 0, bottom: 0, width: 1, height: 1, opacity: 0 }}
      pointerEvents="none"
    />
  )
}

/** Full-screen viewers present over the chat as their own screen, with safe-area insets available inside the modal. */
export function ViewerScreen({
  open,
  onClose,
  children,
  landscape,
}: {
  open: boolean
  onClose(): void
  children: ReactNode
  landscape?: boolean
}) {
  return (
    <Modal
      visible={open}
      presentationStyle="fullScreen"
      animationType="slide"
      onRequestClose={onClose}
      supportedOrientations={landscape ? ['portrait', 'landscape', 'landscape-left', 'landscape-right'] : undefined}
    >
      <SafeAreaProvider>
        <ViewerScreenBody>{children}</ViewerScreenBody>
      </SafeAreaProvider>
    </Modal>
  )
}
function ViewerScreenBody({ children }: { children: ReactNode }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: c.window }}
    >
      <View accessibilityViewIsModal style={{ flex: 1, paddingTop: insets.top }}>
        {children}
      </View>
    </KeyboardAvoidingView>
  )
}
