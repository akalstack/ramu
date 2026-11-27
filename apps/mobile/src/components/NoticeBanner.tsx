import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import Reanimated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useGlobalSearchParams, useRouter } from 'expo-router'
import { Bell, X } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { Glass } from './Glass'
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
  const slide = useSharedValue(0)
  const slideStyle = useAnimatedStyle(() => ({
    opacity: slide.value,
    transform: [{ translateY: interpolate(slide.value, [0, 1], [-24, 0]) }],
  }))
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
      slide.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished) scheduleOnRN(setShown, undefined)
      })
      return
    }
    setShown(notice)
    slide.value = 0
    slide.value = withSpring(1, { damping: 22, stiffness: 240, mass: 1 })
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
    <Reanimated.View
      pointerEvents="box-none"
      style={[
        { position: 'absolute', zIndex: 100, top: insets.top + space.s, left: space.m, right: space.m },
        slideStyle,
      ]}
    >
      <Glass floating radius={radius.l}>
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
    </Reanimated.View>
  )
}
