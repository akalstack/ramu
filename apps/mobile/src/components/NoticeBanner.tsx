import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useGlobalSearchParams, useRouter } from 'expo-router'
import { Bell, X } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { Glass, floatingChrome } from './Glass'
import { T, tap } from './ui'
import { useSay } from '../i18n'

// How long a notice stays: long enough to read, longer when the agent is waiting on the user.
const SHOW_MS = 5000
const SHOW_MS_INPUT = 9000

/**
 * The in-app notification, shown over every screen like the desktop's update toast. It slides in from the top,
 * leaves by itself after a few seconds, and is skipped when you are already looking at that chat.
 */
export function NoticeBanner() {
  const say = useSay()
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const store = useStore()
  const { id: openChat } = useGlobalSearchParams<{ id?: string }>()
  const [toasted, setToasted] = useState<Set<string>>(new Set())
  const keyOf = (n: (typeof store.notifications)[number]) => `${n.computerId}:${n.chatId}:${n.body}`
  // Each notice pops up once; if it isn't acted on it waits in the activity tray instead of disappearing.
  const notice = store.notifications.find((n) => !toasted.has(keyOf(n)))
  const [shown, setShown] = useState<typeof notice>()
  const slide = useRef(new Animated.Value(0)).current
  const viewing = Boolean(notice && openChat === notice.chatId)
  const key = notice ? keyOf(notice) : ''
  const park = () => setToasted((old) => new Set(old).add(key))

  // Already in that chat: the transcript shows it, so drop the notice instead of covering the screen.
  useEffect(() => {
    if (notice && viewing) store.dismissNotification(store.notifications.indexOf(notice))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [key, viewing] by design; the values it reads beyond these are current as of that run
  }, [key, viewing])
  useEffect(() => {
    if (!notice || viewing) {
      Animated.timing(slide, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setShown(undefined)
      })
      return
    }
    setShown(notice)
    slide.setValue(0)
    Animated.spring(slide, { toValue: 1, damping: 22, stiffness: 240, mass: 1, useNativeDriver: true }).start()
    const timer = setTimeout(park, notice.body === 'Needs your input' ? SHOW_MS_INPUT : SHOW_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [key, viewing] by design; the values it reads beyond these are current as of that run
  }, [key, viewing])

  if (!shown) return null
  const open = () => {
    tap()
    store.select(shown.computerId)
    store.acknowledge(shown.chatId)
    store.dismissNotification(store.notifications.findIndex((n) => keyOf(n) === keyOf(shown)))
    router.push({ pathname: '/chat/[id]', params: { id: shown.chatId } })
  }
  const computer = store.computers.find((pc) => pc.id === shown.computerId)?.name
  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        zIndex: 100,
        top: insets.top + space.s,
        left: space.m,
        right: space.m,
        opacity: slide,
        transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
      }}
    >
      <Glass radius={radius.l} style={{ backgroundColor: floatingChrome ? undefined : c.raised }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.m,
            paddingLeft: space.l,
            paddingRight: space.s,
            paddingVertical: space.s,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${shown.title}. ${say(shown.body)}`}
            onPress={open}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s }}
          >
            <Bell size={16} color={c.accent} />
            <View style={{ flex: 1, gap: 1 }}>
              <T size={font.control} weight="600" numberOfLines={1}>
                {shown.title}
              </T>
              <T size={font.caption} tone="muted" numberOfLines={1}>
                {computer ? `${computer} · ${say(shown.body)}` : say(shown.body)}
              </T>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={say('Move to activity')}
            hitSlop={8}
            onPress={park}
            style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={15} color={c.muted} />
          </Pressable>
        </View>
      </Glass>
    </Animated.View>
  )
}
