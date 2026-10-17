import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type ViewStyle,
} from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import * as Clipboard from 'expo-clipboard'
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleHelp,
  Loader,
  type LucideProps,
} from 'lucide-react-native'
import type { TaskStatus } from '@ramu/shared/types'
import { font, radius, space, useTheme } from '../theme'
import type { ComputerStatus } from '../runtime/types'
import { Glass } from './Glass'
import { MaterialSheet } from './MaterialSheet'

export type Icon = ComponentType<LucideProps>

let hapticsEnabled = true
/** The phone's "Haptic feedback" setting; every tap in the app goes through `tap`, so it is the one switch. */
export function setHapticsEnabled(on: boolean) {
  hapticsEnabled = on
}
export function tap() {
  if (hapticsEnabled) Haptics.selectionAsync().catch(() => {})
}

type Tone = 'text' | 'body' | 'soft' | 'muted' | 'placeholder' | 'accent' | 'ok' | 'warn' | 'bad'

/**
 * The app's text. `copyable` makes a long press copy it (pass the string when the children are not one). It stands in for the
 * `selectable` prop: selectable text is drawn by a different native view that ignores our colours and renders black.
 */
export function T({
  tone = 'text',
  size = font.body,
  weight,
  mono,
  style,
  copyable,
  onLongPress,
  ...rest
}: TextProps & {
  tone?: Tone
  size?: number
  weight?: '400' | '500' | '600' | '700'
  mono?: boolean
  copyable?: string | boolean
}) {
  const { c } = useTheme()
  const value =
    typeof copyable === 'string' ? copyable : copyable && typeof rest.children === 'string' ? rest.children : undefined
  const copy =
    value === undefined
      ? onLongPress
      : (event: Parameters<NonNullable<TextProps['onLongPress']>>[0]) => {
          onLongPress?.(event)
          void Clipboard.setStringAsync(value)
            .then(() =>
              hapticsEnabled ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : undefined,
            )
            .catch(() => {})
        }
  // `color: undefined` in a passed style would otherwise replace the tone with the platform default (black); drop it.
  const flat = StyleSheet.flatten(style)
  const own =
    flat && 'color' in flat && flat.color === undefined
      ? (({ color: _unused, ...restStyle }) => restStyle)(flat)
      : style
  return (
    <Text
      {...rest}
      onLongPress={copy}
      style={[{ color: c[tone], fontSize: size, fontWeight: weight, fontFamily: mono ? font.mono : undefined }, own]}
    />
  )
}

export function IconButton({
  icon: I,
  onPress,
  label,
  size = 36,
  tone = 'soft',
  filled,
  style,
}: {
  icon: Icon
  onPress?: () => void
  label: string
  size?: number
  tone?: Tone
  filled?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={() => {
        tap()
        onPress?.()
      }}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: radius.s,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? c.pressed : filled ? c.fill : 'transparent',
        },
        style,
      ]}
    >
      <I size={Math.round(size * 0.5)} color={c[tone]} strokeWidth={1.8} />
    </Pressable>
  )
}

export function Button({
  title,
  icon: I,
  onPress,
  kind = 'primary',
  disabled,
  style,
}: {
  title: string
  icon?: Icon
  onPress?: () => void
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost'
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const { c } = useTheme()
  const bg = { primary: c.primary, secondary: c.fill, danger: c.badWash, ghost: 'transparent' }[kind]
  const fg = { primary: c.primaryInk, secondary: c.text, danger: c.bad, ghost: c.soft }[kind]
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      android_ripple={{ color: kind === 'primary' ? 'rgba(255,255,255,0.16)' : c.pressed }}
      disabled={disabled}
      onPress={() => {
        tap()
        onPress?.()
      }}
      style={({ pressed }) => [
        styles.button,
        Platform.OS === 'android' && { minHeight: 48, borderRadius: radius.full, overflow: 'hidden' },
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {I ? <I size={16} color={fg} strokeWidth={2} /> : null}
      <Text style={{ color: fg, fontSize: font.control + 1, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  )
}

/** The app's one switch: violet track and a white thumb on every platform (Android's default thumb is teal). */
export function Toggle({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
}: {
  value: boolean
  onValueChange: (value: boolean) => void
  disabled?: boolean
  accessibilityLabel?: string
}) {
  const { c } = useTheme()
  return (
    <Switch
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      value={value}
      onValueChange={onValueChange}
      trackColor={{ false: c.lineStrong, true: c.primary }}
      thumbColor={Platform.OS === 'android' ? (value ? c.primaryInk : c.muted) : undefined}
    />
  )
}

/**
 * The app's one chip: filters, scopes, set pickers. Unselected it is a neutral pill; selected it is a quiet tonal violet
 * with violet text (never the loud filled primary). `fill` is for chips that sit on a card or sheet instead of the page.
 */
export function Chip({
  label,
  count,
  selected,
  onPress,
  icon: I,
  chevron,
  fill,
  small,
  maxLabelWidth,
  accessibilityLabel,
}: {
  label: string
  count?: number
  selected?: boolean
  onPress: () => void
  icon?: Icon
  chevron?: boolean
  fill?: boolean
  small?: boolean
  maxLabelWidth?: number
  accessibilityLabel?: string
}) {
  const { c } = useTheme()
  const tone = selected ? 'accent' : 'text'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={() => {
        tap()
        onPress()
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        height: small ? 28 : 34,
        paddingHorizontal: space.m,
        borderRadius: radius.full,
        backgroundColor: selected ? c.accentSoft : fill ? c.fill : c.raised2,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {I ? <I size={14} color={selected ? c.accent : c.soft} strokeWidth={1.9} /> : null}
      <T
        size={small ? font.caption : font.control}
        weight={selected ? '600' : '500'}
        tone={tone}
        numberOfLines={1}
        style={maxLabelWidth ? { maxWidth: maxLabelWidth } : undefined}
      >
        {label}
      </T>
      {count ? (
        <T size={font.caption} tone={tone} style={{ opacity: 0.7 }}>
          {count}
        </T>
      ) : null}
      {chevron ? <ChevronDown size={13} color={c.muted} /> : null}
    </Pressable>
  )
}

export function Row({
  children,
  onPress,
  style,
  ...rest
}: PressableProps & { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme()
  return (
    <Pressable
      {...rest}
      onPress={onPress}
      style={({ pressed }) => [
        styles.listRow,
        { backgroundColor: pressed && onPress ? c.pressed : 'transparent' },
        style,
      ]}
    >
      {children}
    </Pressable>
  )
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View
      style={[
        styles.row,
        { paddingHorizontal: space.l, paddingTop: space.l, paddingBottom: space.s, justifyContent: 'space-between' },
      ]}
    >
      <T size={font.caption} weight="600" tone="muted" style={{ letterSpacing: 0.3, textTransform: 'uppercase' }}>
        {children}
      </T>
      {right}
    </View>
  )
}

/** A rounded group on the raised surface, separated from the canvas by shade only. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme()
  return (
    <View style={[{ backgroundColor: c.raised2, borderRadius: radius.m, overflow: 'hidden' }, style]}>{children}</View>
  )
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { c } = useTheme()
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.lineStrong, marginLeft: inset }} />
}

export function Pill({ children, tone = 'muted', wash }: { children: ReactNode; tone?: Tone; wash?: string }) {
  const { c } = useTheme()
  return (
    <View
      style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.full, backgroundColor: wash ?? c.fill }}
    >
      <T size={11} weight="600" tone={tone}>
        {children}
      </T>
    </View>
  )
}

export function StatusIcon({ status, size = 16 }: { status: TaskStatus; size?: number }) {
  const { c } = useTheme()
  switch (status) {
    case 'running':
      return <Loader size={size} color={c.accent} strokeWidth={2} />
    case 'needs-input':
      return <CircleHelp size={size} color={c.warn} strokeWidth={2} />
    case 'ready-for-review':
      return <CircleCheck size={size} color={c.ok} strokeWidth={2} />
    case 'failed':
      return <CircleAlert size={size} color={c.bad} strokeWidth={2} />
    default:
      return <CircleDot size={size} color={c.placeholder} strokeWidth={1.6} />
  }
}

export function ConnectionDot({ status, size = 8 }: { status: ComputerStatus; size?: number }) {
  const { c } = useTheme()
  const color = { online: c.ok, connecting: c.warn, offline: c.placeholder, revoked: c.bad }[status]
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
}

type SheetProps = {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** `false`: the content scrolls itself (a FlatList), so the sheet must not wrap it in a ScrollView. */
  scroll?: boolean
}

/** What every sheet shows: an optional drag handle (iOS draws its own; Android's Material sheet has one), the title, the content. */
function SheetBody({
  title,
  children,
  scroll = true,
  handle,
}: Omit<SheetProps, 'open' | 'onClose'> & { handle: boolean }) {
  const { c } = useTheme()
  return (
    <>
      {handle ? (
        <View style={{ alignItems: 'center', paddingTop: space.s }}>
          <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: c.lineStrong }} />
        </View>
      ) : null}
      {title ? (
        <T
          size={font.heading}
          weight="600"
          style={{ paddingHorizontal: space.l + 4, paddingTop: space.m, paddingBottom: space.s }}
        >
          {title}
        </T>
      ) : null}
      {scroll ? (
        <ScrollView bounces={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: space.m }}>
          {children}
        </ScrollView>
      ) : (
        <View style={{ paddingBottom: space.m, flexShrink: 1 }}>{children}</View>
      )}
    </>
  )
}

/**
 * The app's one bottom sheet. Android shows the official Material 3 modal bottom sheet (opaque, with its own handle, scrim
 * and swipe-to-dismiss). Elsewhere it is built on Modal so it runs in Expo Go; on iOS it floats inset from the edges on glass.
 */
export function Sheet(props: SheetProps) {
  if (Platform.OS === 'android')
    return (
      <MaterialSheet open={props.open} onClose={props.onClose}>
        <SheetBody {...props} handle={false} />
      </MaterialSheet>
    )
  return <FloatingSheet {...props} />
}

/** The floating glass panel, sitting just above the home indicator. */
function SheetPanel({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <Glass radius={34} style={{ marginHorizontal: 8, marginBottom: Math.max(insets.bottom - 18, 8), maxHeight: '80%' }}>
      {children}
    </Glass>
  )
}

function FloatingSheet({ open, onClose, title, children, scroll }: SheetProps) {
  const body = (
    <SheetBody title={title} scroll={scroll} handle>
      {children}
    </SheetBody>
  )
  const [mounted, setMounted] = useState(open)
  const progress = useRef(new Animated.Value(0)).current
  const rise = () =>
    Animated.spring(progress, { toValue: 1, damping: 26, stiffness: 260, mass: 1, useNativeDriver: true }).start()
  useEffect(() => {
    // Reopened while it was still sliding away: the modal never left, so onShow won't fire again.
    if (open) {
      if (mounted) rise()
      else setMounted(true)
    } else if (mounted)
      Animated.timing(progress, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false)
      })
  }, [open])
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [Dimensions.get('window').height * 0.6, 0],
  })
  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onShow={rise}
      onRequestClose={onClose}
    >
      {/* A Modal is its own window: it measures the device's insets itself, instead of inheriting a tab screen's
          (which include the tab bar and would lift the sheet off the bottom edge). */}
      <SafeAreaProvider>
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: 'rgba(0,0,0,0.35)',
            opacity: progress,
          }}
        >
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            justifyContent: 'flex-end',
            transform: [{ translateY }],
          }}
        >
          <SheetPanel>{body}</SheetPanel>
        </Animated.View>
      </SafeAreaProvider>
    </Modal>
  )
}

/**
 * The app's one tab switcher (iOS segmented-control style): File / Changes / Staged, Changes / Commits / Stashes, and any
 * new tabs. Labels are white on the dark theme (the selected one bold on a raised segment), counts sit beside them.
 * Use this instead of drawing tabs per screen, so they all look and read the same.
 */
export function Segmented<K extends string>({
  value,
  onChange,
  options,
  style,
}: {
  value: K
  onChange: (key: K) => void
  options: readonly { key: K; label: string; count?: number }[]
  style?: StyleProp<ViewStyle>
}) {
  const { c, scheme } = useTheme()
  // iOS look: a gray track with a lifted segment (white in light, a lighter gray in dark).
  const track = scheme === 'light' ? c.fill : c.raised2
  const thumb = scheme === 'light' ? c.raised2 : c.raised
  return (
    <View
      accessibilityRole="tablist"
      style={[{ flexDirection: 'row', backgroundColor: track, borderRadius: radius.m, padding: 3 }, style]}
    >
      {options.map((option) => {
        const selected = option.key === value
        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.count ? `${option.label}, ${option.count}` : option.label}
            onPress={() => {
              if (!selected) {
                tap()
                onChange(option.key)
              }
            }}
            style={{
              flex: 1,
              height: 34,
              borderRadius: radius.m - 3,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 5,
              backgroundColor: selected ? thumb : 'transparent',
            }}
          >
            <T
              size={font.control}
              weight={selected ? '600' : '500'}
              tone="text"
              style={{ opacity: selected ? 1 : 0.7 }}
            >
              {option.label}
            </T>
            {option.count ? (
              <T size={font.caption} tone="text" style={{ opacity: selected ? 0.7 : 0.5 }}>
                {option.count}
              </T>
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )
}

export const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  button: {
    height: 40,
    borderRadius: radius.s + 2,
    paddingHorizontal: space.l,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingHorizontal: space.l,
    paddingVertical: 11,
    minHeight: 48,
  },
})
