import { useSyncExternalStore } from 'react'
import { Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Activity, Bell, Loader, MessageCircleQuestion, X } from 'lucide-react-native'
import { font, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { Row, SectionLabel, Sheet, T, tap } from './ui'

let isOpen = false
const listeners = new Set<() => void>()
const setOpen = (value: boolean) => { isOpen = value; for (const listener of listeners) listener() }
/** Opens the activity sheet from anywhere (the Home header's bell). */
export const openActivity = () => setOpen(true)

/** What is going on, and what was missed, for the selected computer. */
export function useActivitySummary() {
  const store = useStore()
  const mine = (id: string) => id === store.selected
  const waiting = store.chats.filter(chat => mine(chat.computerId) && chat.status === 'needs-input' && !chat.pending)
  const working = store.chats.filter(chat => mine(chat.computerId) && chat.status === 'running' && !chat.pending)
  const background = store.activity[store.selected] ?? []
  const missed = store.inbox[store.selected] ?? []
  return { waiting, working, background, missed, count: waiting.length + working.length + background.length + missed.length }
}

/**
 * One place for what is going on and what you missed, like the desktop's background activity: chats waiting on you,
 * chats working, the computer's own background tasks, and notices that popped up and were not opened.
 * It opens from the bell in Home's navigation bar, where the count shows, so nothing floats over the composer or the lists.
 */
export function ActivityTray() {
  const { c } = useTheme()
  const router = useRouter()
  const store = useStore()
  const open = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => isOpen)
  const { waiting, working, background, missed, count } = useActivitySummary()
  const computer = store.computers.find(pc => pc.id === store.selected)?.name
  const go = (computerId: string, chatId: string) => { setOpen(false); store.select(computerId); setTimeout(() => router.push({ pathname: '/chat/[id]', params: { id: chatId } }), 300) }
  return (
    <>
      <Sheet open={open} onClose={() => setOpen(false)} title="Activity">
        {missed.length ? (
          <>
            <SectionLabel right={<Pressable accessibilityRole="button" hitSlop={8} onPress={() => { tap(); store.clearNotices(store.selected) }}><T size={font.caption} weight="600" tone="accent">Clear all</T></Pressable>}>Missed</SectionLabel>
            {missed.map((notice) => (
              <Row key={notice.id} onPress={() => { store.dismissNotice(store.selected, notice.id); go(store.selected, store.resolveChat(store.selected, notice.taskId)) }}>
                <Bell size={17} color={c.warn} />
                <View style={{ flex: 1 }}>
                  <T weight="500" numberOfLines={1}>{notice.title}</T>
                  <T size={font.caption} tone="muted" numberOfLines={1}>{`${computer ?? ''} · ${notice.body}`}</T>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8} onPress={() => store.dismissNotice(store.selected, notice.id)}><X size={16} color={c.muted} /></Pressable>
              </Row>
            ))}
          </>
        ) : null}
        {waiting.length ? <SectionLabel>Needs you</SectionLabel> : null}
        {waiting.map(chat => (
          <Row key={chat.id} onPress={() => go(chat.computerId, chat.id)}>
            <MessageCircleQuestion size={17} color={c.warn} />
            <T style={{ flex: 1 }} weight="500" numberOfLines={1}>{chat.title}</T>
          </Row>
        ))}
        {working.length ? <SectionLabel>Working</SectionLabel> : null}
        {working.map(chat => (
          <Row key={chat.id} onPress={() => go(chat.computerId, chat.id)}>
            <Loader size={17} color={c.accent} />
            <T style={{ flex: 1 }} weight="500" numberOfLines={1}>{chat.title}</T>
          </Row>
        ))}
        {background.length ? <SectionLabel>{`On ${computer ?? 'the computer'}`}</SectionLabel> : null}
        {background.map(item => (
          <Row key={item.id} disabled>
            <Activity size={17} color={c.soft} />
            <View style={{ flex: 1 }}>
              <T weight="500" numberOfLines={1}>{item.label}</T>
              {item.detail ? <T size={font.caption} tone="muted" numberOfLines={1}>{item.detail}</T> : null}
            </View>
          </Row>
        ))}
        {!count ? <T tone="muted" style={{ padding: space.l }}>Nothing going on.</T> : null}
      </Sheet>
    </>
  )
}
