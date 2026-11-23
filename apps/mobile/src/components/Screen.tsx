import { pastScrollEdge } from '../runtime/scrollSurface'
import { LegendList, type LegendListProps, type LegendListRef } from '@legendapp/list/react-native'
import { backHistory, goBackOrHome, screenTitles } from '../runtime/navigation'
import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from 'react'
import {
  Alert,
  Platform,
  StyleSheet,
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
  type LayoutChangeEvent,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MenuView, type MenuComponentRef } from '@react-native-menu/menu'
import { Stack, useNavigation, useRoute, useRouter } from 'expo-router'
import { ScrollViewMarker } from 'react-native-screens/experimental'
import { ArrowLeft, ChevronLeft, MoreHorizontal, X } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { Glass, floatingChrome } from './Glass'
import { Button, IconButton, T, tap, type Icon } from './ui'
import { useReadableColumn } from './ReadableColumn'
import { useSay } from '../i18n'
import { useInDetailPane } from './paneContext'

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
// iOS reports its version as a string such as "26.0.1", which Number() turns into NaN, so compare the major version only.
/** iOS 26 or later: Liquid Glass bars, which large titles need transparent and which stand taller than older bars. */
export const liquidGlass = Platform.OS === 'ios' && parseInt(String(Platform.Version), 10) >= 26
const scrollEdges = { top: 'soft', bottom: 'hidden', left: 'hidden', right: 'hidden' } as const
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
/**
 * Page lists and scroll views keep their content in the readable column on a tablet unless they pass `fullWidth`: code and
 * diffs, and screens under a native large title, which stays at the leading edge, so their rows line up with it.
 */
type Readable = { fullWidth?: boolean }
function useReadableProps(
  props: { contentContainerStyle?: StyleProp<ViewStyle>; onLayout?: (event: LayoutChangeEvent) => void },
  enabled: boolean,
) {
  const column = useReadableColumn(enabled)
  const { onLayout } = props
  return {
    contentContainerStyle: column.contentContainerStyle(props.contentContainerStyle),
    onLayout: (event: LayoutChangeEvent) => {
      column.onLayout(event)
      onLayout?.(event)
    },
  }
}
export function PageScrollView({
  ref,
  horizontal,
  fullWidth,
  ...props
}: ComponentProps<typeof ScrollView> & Readable & { ref?: Ref<import('react-native').ScrollViewInstance> }) {
  const readable = useReadableProps(props, !horizontal && !fullWidth)
  // A field inside a page scrolls above the keyboard on iOS (Android resizes the window). Screens that pad their own
  // bottom composer for the keyboard pass `automaticallyAdjustKeyboardInsets={false}`.
  const view = (
    <ScrollView
      automaticallyAdjustKeyboardInsets={!horizontal}
      keyboardShouldPersistTaps="handled"
      {...props}
      {...readable}
      ref={ref}
      horizontal={horizontal}
    />
  )
  return horizontal ? view : <PrimaryScroll>{view}</PrimaryScroll>
}
export function PageFlatList<T>({
  ref,
  fullWidth,
  ...props
}: FlatListProps<T> & Readable & { ref?: Ref<FlatList<T>> }) {
  const { c } = useTheme()
  const readable = useReadableProps(props, !props.horizontal && !fullWidth)
  return (
    <PrimaryScroll>
      <FlatList {...props} {...readable} ref={ref} style={[{ backgroundColor: c.window }, props.style]} />
    </PrimaryScroll>
  )
}

/**
 * A long, growing list (a thread's transcript): only the rows near the screen are mounted, rows of one kind share a size
 * estimate, and it can open at its end without laying out everything above it. Rows keep their own state (an open tool
 * call, words still fading in), so a row is remounted rather than reused for another item unless a list opts in.
 */
export function PageLegendList<T>({
  ref,
  recycleItems = false,
  fullWidth,
  ...props
}: LegendListProps<T> & Readable & { ref?: Ref<LegendListRef> }) {
  const { c } = useTheme()
  const readable = useReadableProps(props, !props.horizontal && !fullWidth)
  return (
    <PrimaryScroll>
      <LegendList
        {...props}
        {...readable}
        ref={ref}
        recycleItems={recycleItems}
        style={[{ backgroundColor: c.window }, props.style]}
      />
    </PrimaryScroll>
  )
}

type HeaderButtonProps = {
  icon: Icon
  label: string
  onPress?: () => void
  systemIcon?: ComponentProps<typeof Stack.Toolbar.Button>['icon']
  /** Stable native item identity, retained when an action changes between destinations. */
  actionId?: string
  /** Shown but not usable yet: an action that stays in the bar instead of popping in once it applies. */
  disabled?: boolean
}

/** A navigation-bar action. On iOS it is a glass circle (iOS 26 bar buttons); on Android a plain icon button. */
export function HeaderButton({ icon: I, label, onPress, disabled }: HeaderButtonProps) {
  const { c } = useTheme()
  if (!floatingChrome) return <IconButton icon={I} label={label} onPress={onPress} disabled={disabled} />
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={() => {
        tap()
        onPress?.()
      }}
      style={{ width: BAR, height: BAR, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}
    >
      <I size={21} color={c.text} strokeWidth={1.9} />
    </Pressable>
  )
}

export type HeaderMenuAction = {
  label: string
  onPress(): void
  destructive?: boolean
  disabled?: boolean
  icon?: ComponentProps<typeof Stack.Toolbar.MenuAction>['icon']
  /** Consecutive actions sharing a section render as one inline group, divided from the next like an iOS menu section. */
  section?: string
}
/** A native menu anchored to the toolbar button; other platforms retain their existing action surface. */
export function HeaderMenu({ label, onPress }: { label: string; actions: HeaderMenuAction[]; onPress(): void }) {
  return <HeaderButton icon={MoreHorizontal} label={label} onPress={onPress} />
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
 * Android's bar has no back history of its own, so its Back keeps the iOS shortcut: a tap goes back, and holding it lists
 * the earlier screens to jump straight to one.
 */
function AndroidBack() {
  const say = useSay()
  const router = useRouter()
  const navigation = useNavigation()
  const menu = useRef<MenuComponentRef>(null)
  const history = backHistory(navigation.getState() ?? { routes: [] })
  return (
    <View>
      {/* The menu only anchors the list to the button; the button above it takes every touch. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <MenuView
          ref={menu}
          style={StyleSheet.absoluteFill}
          actions={history.map((entry) => ({ id: String(entry.count), title: entry.label }))}
          onPressAction={({ nativeEvent }) => router.dismiss(Number(nativeEvent.event))}
        >
          <View style={StyleSheet.absoluteFill} />
        </MenuView>
      </View>
      <IconButton
        icon={ArrowLeft}
        label={say('Back')}
        hint={history.length > 1 ? say('Hold to choose an earlier screen') : undefined}
        tone="text"
        onPress={() => goBackOrHome(router)}
        onLongPress={
          history.length > 1
            ? () => {
                tap()
                menu.current?.show()
              }
            : undefined
        }
      />
    </View>
  )
}

/**
 * Compact native bars reserve an opaque surface so scrolling content stays below their controls.
 * Native large-title screens retain UIKit's scroll-edge transition.
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
  align = 'left',
  scrollEdge = false,
  scrolled,
  search = false,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  left?: ReactNode
  right?: ReactNode
  back?: boolean
  modal?: boolean
  large?: boolean
  collapsed?: boolean
  /** Titles and subtitles share the leading edge unless a screen opts into centering, which Android never does. */
  align?: 'left' | 'center'
  /** Enables native underlap on large-title screens; compact bars always reserve their height. */
  scrollEdge?: boolean
  /** Raised header surface once content moves beneath a dialog or native navigation bar. */
  scrolled?: boolean
  /** The screen puts a native search button in this bar (`BottomSearch placement="header"`), so the title leaves it room. */
  search?: boolean
}) {
  const say = useSay()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { c } = useTheme()
  const headerSurface = (scrolled ?? (large ? collapsed : false)) ? c.raised2 : c.window
  // Beside the thread list the native bar would span both panes, so the page draws its own and the list holds Back.
  const inPane = useInDetailPane()
  const { width } = useWindowDimensions()
  // Names this screen in the back menus of the screens opened after it. Route keys are unique, so writing on every render
  // is idempotent, and a closed screen's entry is never looked up again.
  const routeKey = useRoute().key
  const label = typeof title === 'string' && title ? title : typeof subtitle === 'string' ? subtitle : ''
  if (label) screenTitles.set(routeKey, label)
  // Centered between the back button and up to two trailing items (one glass capsule).
  const titleWidth = Math.max(120, Math.min(220, width - 220))
  const close = () => goBackOrHome(router)
  const nativeItems = (children: ReactNode): ReactNode[] =>
    Children.toArray(children).flatMap<ReactNode>((child, index) => {
      if (!isValidElement(child)) return []
      if (child.type === Fragment) return nativeItems((child.props as { children?: ReactNode }).children)
      if (child.type === HeaderMenu) {
        const props = child.props as { label: string; actions: HeaderMenuAction[] }
        const item = (action: HeaderMenuAction) => (
          <Stack.Toolbar.MenuAction
            key={action.label}
            icon={action.icon}
            destructive={action.destructive}
            disabled={action.disabled}
            onPress={action.onPress}
          >
            {action.label}
          </Stack.Toolbar.MenuAction>
        )
        const runs: { section?: string; actions: HeaderMenuAction[] }[] = []
        for (const action of props.actions) {
          const last = runs.at(-1)
          if (last && action.section !== undefined && last.section === action.section) last.actions.push(action)
          else runs.push({ section: action.section, actions: [action] })
        }
        return [
          <Stack.Toolbar.Menu key={props.label} icon="ellipsis" accessibilityLabel={props.label} tintColor={c.text}>
            {runs.map((run, index) =>
              run.section === undefined ? (
                run.actions.map(item)
              ) : (
                <Stack.Toolbar.Menu key={`${run.section}:${index}`} inline>
                  {run.actions.map(item)}
                </Stack.Toolbar.Menu>
              ),
            )}
          </Stack.Toolbar.Menu>,
        ]
      }
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
          key={props.actionId ?? props.label}
          {...{ identifier: props.actionId ?? props.systemIcon ?? props.label }}
          separateBackground={false}
          hidesSharedBackground={false}
          icon={icon}
          accessibilityLabel={props.label}
          disabled={props.disabled}
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
  // Keep the native bar and native back button. The title is a leading toolbar item, not UIKit's centered titleView.
  if (!inPane && Platform.OS === 'ios' && align !== 'center' && (!large || subtitle)) {
    const count = (children: ReactNode): number =>
      Children.toArray(children).reduce<number>((total, child) => {
        if (!isValidElement(child)) return total
        const props = child.props as { children?: ReactNode }
        return total + (child.type === Fragment || child.type === View ? count(props.children) : 1)
      }, 0)
    // Reserve the window margins, the back button and each trailing button with the spacing UIKit keeps around it; a
    // wider title makes the bar fold the trailing buttons into one.
    const available = Math.max(
      48,
      Math.min(520, width - 64 - (back || modal ? BAR + 12 : 0) - (count(right) + (search ? 1 : 0)) * 52),
    )
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            headerTransparent: false,
            // The tab stacks start their first screen with a large title (`tabRootHeaderOptions`); a compact bar turns it off.
            headerLargeTitle: false,
            // UIKit's own Back stays, so holding it lists the earlier screens; the title it shows there is this one.
            title: label,
            headerBackVisible: back && !modal,
            headerBackButtonDisplayMode: 'minimal',
            headerStyle: { backgroundColor: headerSurface },
            scrollEdgeEffects: scrollEdges,
            headerTintColor: c.text,
            headerShadowVisible: false,
          }}
        />
        <Stack.Header
          transparent={false}
          style={{ backgroundColor: headerSurface, color: c.text, shadowColor: 'transparent' }}
          largeStyle={{ backgroundColor: headerSurface, shadowColor: 'transparent' }}
        />
        {/* The title is drawn as the leading item below; an empty title view keeps UIKit from centering it again. */}
        <Stack.Title asChild>
          <View />
        </Stack.Title>
        <Stack.Toolbar key="header-left" placement="left">
          {modal ? (
            <Stack.Toolbar.Button icon="xmark" tintColor={c.text} accessibilityLabel={say('Close')} onPress={close}>
              {say('Close')}
            </Stack.Toolbar.Button>
          ) : null}
          <Stack.Toolbar.View hidesSharedBackground>
            <Pressable
              accessibilityRole={typeof title === 'string' ? 'button' : undefined}
              accessibilityLabel={typeof title === 'string' ? title : undefined}
              onPress={typeof title === 'string' ? () => Alert.alert(title) : undefined}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, width: available }}
            >
              {left}
              <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }}>
                {typeof title === 'string' ? (
                  <T
                    size={13}
                    weight="600"
                    numberOfLines={2}
                    style={{ width: '100%', textAlign: 'left', lineHeight: 15 }}
                  >
                    {title}
                  </T>
                ) : (
                  title
                )}
                {typeof subtitle === 'string' ? (
                  <T size={11} tone="muted" numberOfLines={1} style={{ width: '100%', textAlign: 'left' }}>
                    {subtitle}
                  </T>
                ) : (
                  subtitle
                )}
              </View>
            </Pressable>
          </Stack.Toolbar.View>
        </Stack.Toolbar>
        {/* Keep the native options owner mounted as actions load, disappear or change permissions. */}
        <Stack.Toolbar key="header-right" placement="right">
          {nativeItems(right)}
        </Stack.Toolbar>
      </>
    )
  }
  if (!inPane && Platform.OS === 'android') {
    return (
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: false,
          headerStyle: { backgroundColor: headerSurface },
          headerTintColor: c.text,
          headerShadowVisible: false,
          headerTitle: subtitle
            ? () => (
                <View style={{ alignItems: 'flex-start', maxWidth: 260 }}>
                  <T size={font.heading} weight="600" numberOfLines={1}>
                    {title}
                  </T>
                  {typeof subtitle === 'string' ? (
                    <T size={font.caption} tone="muted" numberOfLines={1}>
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
          // Material top bars lead with the title. Centered, it collides with trailing items such as the host chip.
          headerTitleAlign: 'left',
          headerBackVisible: false,
          headerLeft: modal
            ? () => <HeaderButton icon={X} label={say('Close')} onPress={close} />
            : (back && router.canGoBack()) || left
              ? () => (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, marginRight: space.s }}>
                    {back && router.canGoBack() ? <AndroidBack /> : null}
                    {left}
                  </View>
                )
              : undefined,
          headerRight: right
            ? () => <View style={{ flexDirection: 'row', alignItems: 'center' }}>{right}</View>
            : undefined,
        }}
      />
    )
  }
  if (!inPane && Platform.OS === 'ios') {
    // iOS 26 large titles require a transparent native bar; their scroll view supplies the native edge treatment.
    const underlap = !!large || scrollEdge
    const background =
      underlap && liquidGlass ? (!nativeScrollEdge && scrolled ? headerSurface : 'transparent') : headerSurface
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            headerTintColor: c.text,
            headerStyle: { backgroundColor: background },
            headerTransparent: underlap,
            headerShadowVisible: false,
            scrollEdgeEffects: scrollEdges,
            headerBackVisible: back && !modal,
            headerBackButtonDisplayMode: 'minimal',
            headerTitleAlign: align,
          }}
        />
        <Stack.Header
          transparent={underlap}
          style={{ backgroundColor: background, color: c.text, shadowColor: 'transparent' }}
          largeStyle={{ backgroundColor: 'transparent', shadowColor: 'transparent' }}
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
              <T size={font.heading} weight="600" numberOfLines={1}>
                {title}
              </T>
              {typeof subtitle === 'string' ? (
                <T size={font.caption} tone="muted" numberOfLines={1}>
                  {subtitle}
                </T>
              ) : (
                subtitle
              )}
            </View>
          </Stack.Title>
        )}

        {modal || left || (!back && typeof title !== 'string') ? (
          <Stack.Toolbar key="header-left" placement="left">
            {modal ? (
              <Stack.Toolbar.Button icon="xmark" tintColor={c.text} accessibilityLabel={say('Close')} onPress={close}>
                Close
              </Stack.Toolbar.Button>
            ) : left ? (
              nativeItems(left)
            ) : (
              <Stack.Toolbar.View hidesSharedBackground>
                <View>{title}</View>
              </Stack.Toolbar.View>
            )}
          </Stack.Toolbar>
        ) : null}
        {/* Keep the native options owner mounted as actions load, disappear or change permissions. */}
        <Stack.Toolbar key="header-right" placement="right">
          {nativeItems(right)}
        </Stack.Toolbar>
        {/* UIKit finds the primary scroll view through the first descendant chain.
          Put spacing in the content, so a sibling spacer cannot break that link. */}
      </>
    )
  }
  const leading =
    left ??
    (back && !inPane ? (
      <HeaderButton
        icon={modal ? X : ChevronLeft}
        label={modal ? say('Close') : say('Back')}
        onPress={() => goBackOrHome(router)}
      />
    ) : null)
  return (
    <View style={{ paddingTop: insets.top + space.s, paddingBottom: space.s }}>
      {inPane ? <Stack.Screen options={{ headerShown: false }} /> : null}
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

/**
 * The large-title header the tab lists (Threads, Inbox, Pull requests, Artifacts) draw with `Header large scrollEdge`,
 * given to their stack before the screen mounts. UIKit sets a scroll view's inset from the bar it first lays out under;
 * starting from an opaque compact bar and switching after mount can leave a tab's content parked under the bar.
 */
export function tabRootHeaderOptions(window: string) {
  if (Platform.OS !== 'ios') return {}
  return {
    headerTransparent: true,
    headerLargeTitle: nativeScrollEdge,
    headerStyle: { backgroundColor: liquidGlass ? 'transparent' : window },
    headerShadowVisible: false,
    scrollEdgeEffects: scrollEdges,
  }
}

export function Screen({ children, bg }: { children: ReactNode; bg?: 'window' | 'canvas'; scrollable?: boolean }) {
  const { c } = useTheme()
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c[bg ?? 'window'],
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
      setScrolled(
        pastScrollEdge(
          event.nativeEvent.contentOffset.y,
          event.nativeEvent.contentInset?.top ?? insets.top + BAR,
          past,
        ),
      ),
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
        style={[{ minHeight: 48 }, style]}
      />
    )
  const ink = primary ? c.primaryInk : c.text
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: Boolean(disabled) }}
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
          minHeight: 48,
          paddingVertical: space.s,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.s,
          paddingHorizontal: space.l,
        }}
      >
        {I ? <I size={20} color={ink} strokeWidth={2} /> : null}
        <T weight="600" size={font.body} style={{ color: ink, flexShrink: 1, textAlign: 'center' }}>
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
