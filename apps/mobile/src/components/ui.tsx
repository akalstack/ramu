import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import * as Clipboard from 'expo-clipboard'
import { CircleAlert, CircleCheck, CircleDot, CircleHelp, Loader, type LucideProps } from 'lucide-react-native'
import type { TaskStatus } from '@ramu/shared/types'
import { font, radius, space, useTheme } from '../theme'
import type { ComputerStatus } from '../runtime/types'
import { Glass, floatingChrome } from './Glass'

export type Icon = ComponentType<LucideProps>

export function tap() {
  Haptics.selectionAsync().catch(() => {})
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
            .then(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success))
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
      disabled={disabled}
      onPress={() => {
        tap()
        onPress?.()
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {I ? <I size={16} color={fg} strokeWidth={2} /> : null}
      <Text style={{ color: fg, fontSize: font.control + 1, fontWeight: '600' }}>{title}</Text>
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

/** Bottom sheet built on Modal so it runs in Expo Go. On iOS it floats inset from the edges on glass, like iOS 26 sheets. */
/** `scroll={false}`: the content scrolls itself (a FlatList), so the sheet must not wrap it in a ScrollView. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  scroll = true,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  scroll?: boolean
}) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const body = (
    <>
      <View style={{ alignItems: 'center', paddingTop: space.s }}>
        <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: c.lineStrong }} />
      </View>
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
        <ScrollView bounces={false} contentContainerStyle={{ paddingBottom: space.m }}>
          {children}
        </ScrollView>
      ) : (
        <View style={{ paddingBottom: space.m, flexShrink: 1 }}>{children}</View>
      )}
    </>
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
        {floatingChrome ? (
          <Glass
            radius={34}
            style={{ marginHorizontal: 8, marginBottom: Math.max(insets.bottom - 18, 8), maxHeight: '80%' }}
          >
            {body}
          </Glass>
        ) : (
          <View
            style={{
              backgroundColor: c.canvas,
              borderTopLeftRadius: radius.l + 8,
              borderTopRightRadius: radius.l + 8,
              paddingBottom: insets.bottom + space.s,
              maxHeight: '80%',
            }}
          >
            {body}
          </View>
        )}
      </Animated.View>
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
  const { c } = useTheme()
  return (
    <View
      accessibilityRole="tablist"
      style={[{ flexDirection: 'row', backgroundColor: c.raised2, borderRadius: radius.m, padding: 3 }, style]}
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
              backgroundColor: selected ? c.raised : 'transparent',
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
