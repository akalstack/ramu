import { BottomSearch } from './BottomSearch'
import type { SheetSearchProps } from './NativeSheet'
import { NativeSheet } from './NativeSheet'
import { pastScrollEdge } from '../runtime/scrollSurface'
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type Ref,
  type ComponentType,
  type ReactNode,
} from 'react'
import {
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Dimensions,
  Easing,
  Modal,
  KeyboardAvoidingView,
  PanResponder,
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
import { ChevronDown, X, type LucideProps } from 'lucide-react-native'
import { font, radius, space, TEXT_SCALE, useTheme } from '../theme'
import type { ComputerStatus } from '../runtime/types'
import { MaterialSheet } from './MaterialSheet'
import { useSay } from '../i18n'

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
  const { c, textSize } = useTheme()
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
      // iOS dims pressable text under a resting finger, so held or scrolled text would change colour; it stays put.
      suppressHighlighting
      {...rest}
      onLongPress={copy}
      style={[
        {
          color: c[tone],
          fontSize: size * TEXT_SCALE[textSize],
          fontWeight: weight,
          fontFamily: mono ? font.mono : undefined,
        },
        own,
      ]}
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
  disabled,
  style,
}: {
  icon: Icon
  onPress?: () => void
  label: string
  size?: number
  tone?: Tone
  filled?: boolean
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={6}
      onPress={() => {
        tap()
        onPress?.()
      }}
      style={({ pressed }) => [
        {
          opacity: disabled ? 0.4 : 1,
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
  accessibilityLabel,
  icon: I,
  onPress,
  kind = 'primary',
  disabled,
  style,
}: {
  title: string
  accessibilityLabel?: string
  icon?: Icon
  onPress?: () => void
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost'
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const { c, textSize } = useTheme()
  const bg = { primary: c.primary, secondary: c.fill, danger: c.badWash, ghost: 'transparent' }[kind]
  const fg = { primary: c.primaryInk, secondary: c.text, danger: c.bad, ghost: c.soft }[kind]
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
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
      <Text
        style={{
          color: fg,
          fontSize: (font.control + 1) * TEXT_SCALE[textSize],
          fontWeight: '600',
          flexShrink: 1,
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
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
  onLongPress,
  accessibilityHint,
  status,
}: {
  label: string
  /** A host's connection, drawn as the app's status dot before the label instead of a word. */
  status?: ComputerStatus
  count?: number
  selected?: boolean
  onPress: () => void
  onLongPress?: () => void
  accessibilityHint?: string
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
      accessibilityHint={accessibilityHint}
      onPress={() => {
        tap()
        onPress()
      }}
      onLongPress={
        onLongPress
          ? () => {
              tap()
              onLongPress()
            }
          : undefined
      }
      delayLongPress={350}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        minHeight: small ? 28 : 34,
        paddingVertical: space.xs,
        paddingHorizontal: space.m,
        borderRadius: radius.full,
        backgroundColor: selected ? c.accentSoft : fill ? c.fill : c.raised2,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {I ? <I size={14} color={selected ? c.accent : c.soft} strokeWidth={1.9} /> : null}
      {status ? <ConnectionDot status={status} size={7} /> : null}
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
      accessibilityRole={onPress ? 'button' : undefined}
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

/** Where a full-width list row's text starts after a 16pt leading icon; its divider begins there, as in iOS lists. */
export const ROW_INSET = space.l + 16 + space.m

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

export function ConnectionDot({ status, size = 8 }: { status: ComputerStatus; size?: number }) {
  const { c } = useTheme()
  const color = { online: c.ok, connecting: c.warn, offline: c.placeholder, revoked: c.bad, paused: c.placeholder }[
    status
  ]
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
}

type SheetScrollEvent = NativeSyntheticEvent<NativeScrollEvent>
const SheetScroll = createContext<((event: SheetScrollEvent) => void) | null>(null)

/** Self-scrolling sheet content reports its position to the shared header. */
export function SheetScrollView({
  ref,
  onScroll,
  ...props
}: ComponentProps<typeof ScrollView> & { ref?: Ref<import('react-native').ScrollViewInstance> }) {
  const report = useContext(SheetScroll)
  return (
    <ScrollView
      // A sheet that scrolls itself keeps the field being typed in above the keyboard; iOS's own sheet scroll does not
      // know about text fields inside it.
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      {...props}
      contentContainerStyle={[{ paddingBottom: space.l }, props.contentContainerStyle]}
      ref={ref}
      scrollEventThrottle={16}
      onScroll={(event) => {
        report?.(event)
        onScroll?.(event)
      }}
    />
  )
}
type SheetProps = {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** `false`: the content scrolls itself (a FlatList), so the sheet must not wrap it in a ScrollView. */
  scroll?: boolean
  /** Complex workflows use a full-screen layout with room for keyboard input. */
  presentation?: 'sheet' | 'screen'
  search?: SheetSearchProps
}

/** What every sheet shows: an optional drag handle (iOS draws its own; Android's Material sheet has one), the title, the content. */
function SheetBody({
  title,
  children,
  scroll = true,
  handle,
  drag,
  search,
}: Omit<SheetProps, 'open' | 'onClose'> & { handle: boolean; drag?: object }) {
  const { c } = useTheme()
  const [scrolled, setScrolled] = useState(false)
  const onScroll = (event: SheetScrollEvent) =>
    setScrolled(pastScrollEdge(event.nativeEvent.contentOffset.y, event.nativeEvent.contentInset?.top))
  return (
    <SheetScroll.Provider value={onScroll}>
      {/* The handle and title are the drag area: swiping them down dismisses a floating sheet. */}
      <View
        {...drag}
        style={{
          backgroundColor: scrolled ? c.raised2 : c.window,
          borderBottomWidth: scrolled ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: c.lineStrong,
        }}
      >
        {handle ? (
          <View style={{ alignItems: 'center', paddingTop: space.s, paddingBottom: space.xs }}>
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
      </View>
      {scroll ? (
        <ScrollView
          onScroll={onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          bounces={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ paddingBottom: space.m }}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ paddingBottom: space.m, flexShrink: 1 }}>{children}</View>
      )}
      {search ? <BottomSearch {...search} inputOnly /> : null}
    </SheetScroll.Provider>
  )
}

/**
 * The app's one bottom sheet. Android shows the official Material 3 modal bottom sheet (opaque, with its own handle, scrim
 * and swipe-to-dismiss). Elsewhere it is built on Modal so it runs in Expo Go; on iOS it floats inset from the edges on an opaque surface.
 */
/** How long a closing sheet takes to leave the screen before a picker or another sheet can open. */
export const SHEET_SETTLE_MS = 400

export function Sheet(props: SheetProps) {
  if (Platform.OS === 'ios') return <LazyNativeSheet {...props} />
  if (props.presentation === 'screen') return <ScreenSheet {...props} />
  if (Platform.OS === 'android')
    return (
      <MaterialSheet open={props.open} onClose={props.onClose}>
        <SheetBody {...props} handle={false} />
      </MaterialSheet>
    )
  return <FloatingSheet {...props} />
}

/** How long a closed sheet keeps its native tree, so its dismissal animation finishes before it goes. */
const KEEP_CLOSED_SHEET_MS = 700

/**
 * A screen declares many sheets and opens few. A native sheet's tree and content exist only from its first opening until
 * it has been closed a moment; closed, it renders nothing, so the screen's updates do not redraw every unopened sheet.
 */
function LazyNativeSheet(props: SheetProps) {
  const { open } = props
  const [mounted, setMounted] = useState(open)
  // Presented a frame after mounting, so SwiftUI animates the sheet in rather than showing it already up.
  const [presented, setPresented] = useState(false)
  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const timer = setTimeout(() => setMounted(false), KEEP_CLOSED_SHEET_MS)
    return () => clearTimeout(timer)
  }, [open])
  useEffect(() => {
    if (!mounted) return setPresented(false)
    const frame = requestAnimationFrame(() => setPresented(open))
    return () => cancelAnimationFrame(frame)
  }, [mounted, open])
  return mounted ? <NativeSheet {...props} open={presented} /> : null
}

/** A task surface rather than a bottom drawer: the keyboard resizes its scrollable content. */
function ScreenSheet({ open, onClose, ...props }: SheetProps) {
  return (
    <Modal visible={open} presentationStyle="fullScreen" animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <ScreenSheetBody {...props} onClose={onClose} />
      </SafeAreaProvider>
    </Modal>
  )
}
function ScreenSheetBody({ title, children, scroll = true, onClose, search }: Omit<SheetProps, 'open'>) {
  const say = useSay()
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const [scrolled, setScrolled] = useState(false)
  const onScroll = (event: SheetScrollEvent) =>
    setScrolled(pastScrollEdge(event.nativeEvent.contentOffset.y, event.nativeEvent.contentInset?.top))
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.window }}>
      <SheetScroll.Provider value={onScroll}>
        <View accessibilityViewIsModal style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }}>
          <View
            style={{
              backgroundColor: scrolled ? c.raised2 : c.window,
              borderBottomWidth: scrolled ? StyleSheet.hairlineWidth : 0,
              borderBottomColor: c.lineStrong,
              minHeight: 56,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: space.l,
              gap: space.m,
            }}
          >
            <View style={{ width: 36 }} accessibilityElementsHidden importantForAccessibility="no" />
            <T
              accessibilityRole="header"
              size={font.heading}
              weight="600"
              numberOfLines={1}
              style={{ flex: 1, minWidth: 0, textAlign: 'center' }}
            >
              {title}
            </T>
            <IconButton icon={X} label={say('Close')} onPress={onClose} />
          </View>
          {/* Under the title, so the keyboard never covers it while typing. */}
          {search ? <BottomSearch {...search} inputOnly /> : null}
          {scroll ? (
            <ScrollView
              style={{ flex: 1 }}
              onScroll={onScroll}
              scrollEventThrottle={16}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              contentContainerStyle={{ paddingBottom: space.l }}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={{ flex: 1 }}>{children}</View>
          )}
        </View>
      </SheetScroll.Provider>
    </KeyboardAvoidingView>
  )
}

/** Opaque dialog surface, matching Settings rather than tinting the content behind it. */
function SheetPanel({ children }: { children: ReactNode }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View
      style={{
        backgroundColor: c.window,
        borderRadius: 34,
        overflow: 'hidden',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.lineStrong,
        marginHorizontal: 8,
        marginBottom: Math.max(insets.bottom - 18, 8),
        maxHeight: '80%',
      }}
    >
      {children}
    </View>
  )
}

function FloatingSheet({ open, onClose, title, children, scroll, search }: SheetProps) {
  const say = useSay()
  const [mounted, setMounted] = useState(open)
  const progress = useRef(new Animated.Value(0)).current
  const dragY = useRef(new Animated.Value(0)).current
  const close = useRef(onClose)
  close.current = onClose
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_, gesture) => dragY.setValue(Math.max(0, gesture.dy)),
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 90 || gesture.vy > 0.9) close.current()
        else Animated.spring(dragY, { toValue: 0, damping: 26, stiffness: 260, mass: 1, useNativeDriver: true }).start()
      },
      onPanResponderTerminate: () =>
        Animated.spring(dragY, { toValue: 0, damping: 26, stiffness: 260, mass: 1, useNativeDriver: true }).start(),
    }),
  ).current
  const body = (
    <SheetBody title={title} scroll={scroll} search={search} handle drag={pan.panHandlers}>
      {children}
    </SheetBody>
  )
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
        if (finished) {
          setMounted(false)
          dragY.setValue(0)
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [open] by design; the values it reads beyond these are current as of that run
  }, [open])
  const translateY = Animated.add(
    progress.interpolate({
      inputRange: [0, 1],
      outputRange: [Dimensions.get('window').height * 0.6, 0],
    }),
    dragY,
  )
  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      // A sheet can open over a landscape screen (the computer viewer); it must not rotate the app back.
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
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
          <Pressable
            style={{ flex: 1 }}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={say('Close')}
          />
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
          <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
            <SheetPanel>{body}</SheetPanel>
          </KeyboardAvoidingView>
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
  small,
}: {
  value: K
  onChange: (key: K) => void
  options: readonly { key: K; label: string; count?: number }[]
  style?: StyleProp<ViewStyle>
  /** Compact, for a choice inside a toolbar or the composer: 32 points tall, with a slop that keeps it tappable. */
  small?: boolean
}) {
  const { c, scheme } = useTheme()
  // iOS look: a gray track with a lifted segment (white in light, a lighter gray in dark). In dark both are white washes
  // over whatever is underneath, so the track still shows on a card, which is the same gray as a solid track would be.
  const track = scheme === 'light' ? c.fill : c.pressed
  const thumb = scheme === 'light' ? c.raised2 : 'rgba(255,255,255,0.14)'
  return (
    <View
      accessibilityRole="tablist"
      style={[
        {
          flexDirection: 'row',
          backgroundColor: track,
          borderRadius: small ? radius.s + 2 : radius.m,
          padding: small ? 2 : 3,
        },
        style,
      ]}
    >
      {options.map((option) => {
        const selected = option.key === value
        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.count ? `${option.label}, ${option.count}` : option.label}
            hitSlop={small ? 6 : undefined}
            onPress={() => {
              if (!selected) {
                tap()
                onChange(option.key)
              }
            }}
            style={{
              flex: 1,
              minHeight: small ? 28 : 44,
              paddingVertical: small ? 2 : space.s,
              paddingHorizontal: space.xs,
              borderRadius: small ? radius.s : radius.m - 3,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 5,
              backgroundColor: selected ? thumb : 'transparent',
            }}
          >
            <T
              size={small ? font.caption : font.control}
              weight={selected ? '600' : '500'}
              tone="text"
              style={{ opacity: selected ? 1 : 0.7, flexShrink: 1, textAlign: 'center' }}
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
    minHeight: 44,
    paddingVertical: space.s,
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
