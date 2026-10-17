import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useState,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from 'react'
import {
  Platform,
  UIManager,
  Pressable,
  ScrollView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  FlatList,
  View,
  type FlatListProps,
  type StyleProp,
  type ViewStyle,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Stack, useRouter } from 'expo-router'
import { ScrollViewMarker } from 'react-native-screens/experimental'
import { ChevronLeft, X } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { Glass, floatingChrome } from './Glass'
import { Button, IconButton, T, tap, type Icon } from './ui'

const BAR = 44
// ScrollViewMarker is a react-native-screens "gamma" view: its native side is only compiled when pods are
// installed with RNS_GAMMA_ENABLED=1 (app.config.js sets that by default). In a build without it, creating the
// view throws in Fabric's createNode, so ask the native registry first and fall back to the JS edge below.
function hasNativeMarker() {
  try {
    return Platform.OS === 'ios' && UIManager.hasViewManagerConfig('RNSScrollViewMarker')
  } catch {
    return false
  }
}
const scrollViewMarker = hasNativeMarker()
/** True when UIKit draws the scroll-edge effect and large title itself; otherwise screens use `TopFade` and `LargeTitle`. */
export const nativeScrollEdge = scrollViewMarker
const scrollEdges = { top: 'hard', bottom: 'hidden', left: 'hidden', right: 'hidden' } as const
function PrimaryScroll({ children }: { children: NonNullable<ReactNode> }) {
  if (Platform.OS === 'ios')
    return scrollViewMarker ? (
      <ScrollViewMarker style={{ flex: 1 }} scrollEdgeEffects={scrollEdges}>
        {children}
      </ScrollViewMarker>
    ) : (
      children
    )
  return children
}
export function PageScrollView({
  ref,
  horizontal,
  ...props
}: ComponentProps<typeof ScrollView> & { ref?: Ref<ScrollView> }) {
  const view = <ScrollView {...props} ref={ref} horizontal={horizontal} />
  return horizontal ? view : <PrimaryScroll>{view}</PrimaryScroll>
}
export function PageFlatList<T>({ ref, ...props }: FlatListProps<T> & { ref?: Ref<FlatList<T>> }) {
  return (
    <PrimaryScroll>
      <FlatList {...props} ref={ref} />
    </PrimaryScroll>
  )
}

type HeaderButtonProps = {
  icon: Icon
  label: string
  onPress?: () => void
  systemIcon?: ComponentProps<typeof Stack.Toolbar.Button>['icon']
}

/** A navigation-bar action. On iOS it is a glass circle (iOS 26 bar buttons); on Android a plain icon button. */
export function HeaderButton({ icon: I, label, onPress }: HeaderButtonProps) {
  const { c } = useTheme()
  if (!floatingChrome) return <IconButton icon={I} label={label} onPress={onPress} />
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPress={() => {
        tap()
        onPress?.()
      }}
      style={{ width: BAR, height: BAR, alignItems: 'center', justifyContent: 'center' }}
    >
      <I size={21} color={c.text} strokeWidth={1.9} />
    </Pressable>
  )
}

/** Groups bar buttons into one glass capsule, like the trailing items of an iOS 26 navigation bar. */
function ButtonGroup({ children }: { children: ReactNode }) {
  if (!floatingChrome) return <View style={{ flexDirection: 'row', alignItems: 'center' }}>{children}</View>
  return (
    <Glass
      radius={radius.full}
      interactive
      style={{ flexDirection: 'row', alignItems: 'center', height: BAR, minWidth: BAR, justifyContent: 'center' }}
    >
      {children}
    </Glass>
  )
}

/**
 * UIKit uses a clear scroll-edge appearance at the top and a material background
 * after scrolling. The scroll view owns the automatic inset below the native bar.
 * Android/web use the shared header spacing below.
 */
export function Header({
  title,
  subtitle,
  left,
  right,
  back = true,
  modal,
  large,
  collapsed = true,
  align = Platform.OS === 'android' ? 'left' : 'center',
}: {
  title?: ReactNode
  subtitle?: ReactNode
  left?: ReactNode
  right?: ReactNode
  back?: boolean
  modal?: boolean
  large?: boolean
  collapsed?: boolean
  /** Android uses the standard left-aligned app bar by default. */
  align?: 'left' | 'center'
}) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { c } = useTheme()
  const { width } = useWindowDimensions()
  // Centered between the back button and up to two trailing items (one glass capsule).
  const titleWidth = Math.max(120, Math.min(220, width - 220))
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'))
  if (Platform.OS === 'android') {
    return (
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: false,
          headerStyle: { backgroundColor: c.window },
          headerTintColor: c.text,
          headerShadowVisible: false,
          headerTitle: subtitle
            ? () => (
                <View
                  style={{
                    alignItems: align === 'left' ? 'flex-start' : 'center',
                    maxWidth: align === 'left' ? 260 : 220,
                  }}
                >
                  <T size={17} weight="600" numberOfLines={1}>
                    {title}
                  </T>
                  {typeof subtitle === 'string' ? (
                    <T size={12} tone="muted" numberOfLines={1}>
                      {subtitle}
                    </T>
                  ) : (
                    subtitle
                  )}
                </View>
              )
            : typeof title === 'string'
              ? title
              : '',
          headerTitleStyle: { fontSize: 17, fontWeight: '600' },
          headerTitleAlign: align,
          headerBackVisible: back && !modal,
          headerLeft: modal
            ? () => <HeaderButton icon={X} label="Close" onPress={close} />
            : left
              ? () => <View>{left}</View>
              : undefined,
          headerRight: right
            ? () => <View style={{ flexDirection: 'row', alignItems: 'center' }}>{right}</View>
            : undefined,
        }}
      />
    )
  }
  if (Platform.OS === 'ios') {
    const nativeItems = (children: ReactNode): ReactNode[] =>
      Children.toArray(children).flatMap<ReactNode>((child, index) => {
        if (!isValidElement(child)) return []
        if (child.type === Fragment) return nativeItems((child.props as { children?: ReactNode }).children)
        if (child.type !== HeaderButton)
          return [
            <Stack.Toolbar.View key={index} hidesSharedBackground>
              {child}
            </Stack.Toolbar.View>,
          ]
        const props = child.props as HeaderButtonProps
        const symbols = {
          Settings: 'gearshape',
          Pengaturan: 'gearshape',
          'Source Control': 'arrow.triangle.branch',
          Changes: 'doc.text.magnifyingglass',
          Terminal: 'terminal',
          'Source control actions': 'ellipsis',
        } as const
        const icon = props.systemIcon ?? symbols[props.label as keyof typeof symbols] ?? 'ellipsis'
        return [
          <Stack.Toolbar.Button
            key={props.label}
            icon={icon}
            accessibilityLabel={props.label}
            tintColor={c.text}
            onPress={() => {
              tap()
              props.onPress?.()
            }}
          >
            {props.label}
          </Stack.Toolbar.Button>,
        ]
      })
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            headerTintColor: c.text,
            headerStyle: { backgroundColor: 'transparent' },
            headerTransparent: true,
            headerShadowVisible: false,
            scrollEdgeEffects: { top: 'hard', bottom: 'hidden', left: 'hidden', right: 'hidden' },
            headerBackVisible: back && !modal,
            headerBackButtonDisplayMode: 'minimal',
          }}
        />
        <Stack.Header
          transparent
          style={{ backgroundColor: 'transparent', color: c.text, shadowColor: 'transparent' }}
        />
        {!back && typeof title !== 'string' ? (
          <Stack.Title>{''}</Stack.Title>
        ) : !subtitle && typeof title === 'string' ? (
          <Stack.Title
            large={large && nativeScrollEdge}
            style={{ color: c.text, fontSize: 17, fontWeight: '600' }}
            largeStyle={{ color: c.text }}
          >
            {large && !nativeScrollEdge && !collapsed ? '' : title}
          </Stack.Title>
        ) : (
          <Stack.Title asChild>
            <View style={{ alignItems: 'center', maxWidth: titleWidth }}>
              <T size={17} weight="600" numberOfLines={1}>
                {title}
              </T>
              {typeof subtitle === 'string' ? (
                <T size={12} tone="muted" numberOfLines={1}>
                  {subtitle}
                </T>
              ) : (
                subtitle
              )}
            </View>
          </Stack.Title>
        )}

        {modal || left || (!back && typeof title !== 'string') ? (
          <Stack.Toolbar placement="left">
            {modal ? (
              <Stack.Toolbar.Button icon="xmark" tintColor={c.text} accessibilityLabel="Close" onPress={close}>
                Close
              </Stack.Toolbar.Button>
            ) : (
              <Stack.Toolbar.View hidesSharedBackground>
                <View>{left ?? title}</View>
              </Stack.Toolbar.View>
            )}
          </Stack.Toolbar>
        ) : null}
        {right ? <Stack.Toolbar placement="right">{nativeItems(right)}</Stack.Toolbar> : null}
        {/* UIKit finds the primary scroll view through the first descendant chain.
          Put spacing in the content, so a sibling spacer cannot break that link. */}
      </>
    )
  }
  const leading =
    left ??
    (back ? (
      <HeaderButton
        icon={modal ? X : ChevronLeft}
        label={modal ? 'Close' : 'Back'}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
    ) : null)
  return (
    <View style={{ paddingTop: insets.top + space.s, paddingBottom: space.s }}>
      <View
        style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.l, gap: space.s }}
      >
        {leading ? floatingChrome && !left ? <ButtonGroup>{leading}</ButtonGroup> : leading : null}
        <View style={{ flex: 1, paddingHorizontal: leading ? 2 : space.xs, justifyContent: 'center' }}>
          {typeof title === 'string' ? (
            <T size={font.heading - 1} weight="600" numberOfLines={1}>
              {title}
            </T>
          ) : (
            title
          )}
          {typeof subtitle === 'string' ? (
            <T size={font.caption} tone="muted" numberOfLines={1}>
              {subtitle}
            </T>
          ) : (
            subtitle
          )}
        </View>
        {right && Children.count(right) ? <ButtonGroup>{right}</ButtonGroup> : null}
      </View>
    </View>
  )
}

export function Screen({
  children,
  bg,
  scrollable = true,
}: {
  children: ReactNode
  bg?: 'window' | 'canvas'
  scrollable?: boolean
}) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c[bg ?? 'window'],
        paddingTop: Platform.OS === 'ios' && !scrollable ? insets.top + BAR : 0,
      }}
    >
      {children}
    </View>
  )
}

/**
 * Tracks whether a scroll view has moved under the transparent navigation bar. `past` is how far, in points,
 * beyond the resting position (below the bar) before it counts, e.g. the height of a large title.
 */
export function useScrolledUnderBar(past = 8) {
  const insets = useSafeAreaInsets()
  const [scrolled, setScrolled] = useState(false)
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) =>
      setScrolled(event.nativeEvent.contentOffset.y > past - (insets.top + BAR)),
    [past, insets.top],
  )
  return { scrolled, onScroll }
}

/** Large title for builds without the native one: sits left-aligned at the top of the content, then the bar title takes over. */
export function LargeTitle({ children }: { children: string }) {
  if (nativeScrollEdge || Platform.OS !== 'ios') return null
  return (
    <T
      size={34}
      weight="700"
      numberOfLines={1}
      style={{ paddingHorizontal: space.l, paddingTop: space.s, paddingBottom: space.xs }}
    >
      {children}
    </T>
  )
}

/** A floating action on glass (iOS 26 toolbar style); primary ones are tinted. Android falls back to the filled Button. */
export function GlassButton({
  title,
  icon: I,
  onPress,
  primary,
  disabled,
  style,
}: {
  title: string
  icon?: Icon
  onPress?: () => void
  primary?: boolean
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const { c } = useTheme()
  if (Platform.OS === 'android' || !floatingChrome)
    return (
      <Button
        title={title}
        icon={I}
        kind={primary ? 'primary' : 'secondary'}
        disabled={disabled}
        onPress={onPress}
        style={[{ height: 48 }, style]}
      />
    )
  const ink = primary ? c.primaryInk : c.text
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => {
        tap()
        onPress?.()
      }}
      style={[{ opacity: disabled ? 0.45 : 1 }, style]}
    >
      <Glass
        radius={radius.full}
        interactive
        tint={primary ? c.primary : undefined}
        style={{
          height: 48,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.s,
          paddingHorizontal: space.l,
        }}
      >
        {I ? <I size={20} color={ink} strokeWidth={2} /> : null}
        <T weight="600" size={font.body} style={{ color: ink }}>
          {title}
        </T>
      </Glass>
    </Pressable>
  )
}

/**
 * iOS page sheets start below the status bar, so KeyboardAvoidingView needs that offset or the
 * keyboard covers the sheet's bottom. The home-indicator padding under the content is hidden by
 * the keyboard, so it is taken back out to keep the composer snug above the keys.
 */
export function useSheetKeyboardOffset(): number {
  const insets = useSafeAreaInsets()
  return Platform.OS === 'ios' ? insets.top + BAR + space.m - Math.max(0, insets.bottom - space.s) : 0
}
