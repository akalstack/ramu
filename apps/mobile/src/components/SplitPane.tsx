import { useMemo, useState, type ReactNode } from 'react'
import { FlatList, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, Search, SquarePen } from 'lucide-react-native'
import { translate } from '@ramu/shared/i18n'
import { font, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { STANDALONE, type Chat } from '../runtime/types'
import { LIST_PANE_WIDTH, paneThreads, showsSplit } from '../runtime/splitLayout'
import { goBackOrHome } from '../runtime/navigation'
import { useSay, useT } from '../i18n'
import { ChatRow } from './ChatRow'
import { Button, IconButton, SectionLabel, T } from './ui'
import { DetailPane, ThreadPicker } from './paneContext'

/**
 * A thread on a wide window: the thread list on the left, the thread on the right. Picking another thread swaps the
 * right side in place, so moving between threads is one tap and the list keeps its scroll. A narrower window shows the
 * thread alone, as on a phone. The thread keeps its place in the tree either way, so turning the device does not
 * reload it.
 */
export function ThreadSplit({ id, children }: { id: string; children: ReactNode }) {
  const { c } = useTheme()
  const router = useRouter()
  const window = useWindowDimensions()
  const split = showsSplit(window.width, window.height)
  const picker = useMemo(
    () => ({ openId: id, open: (next: string) => (next === id ? undefined : router.setParams({ id: next })) }),
    [id, router],
  )
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: c.window }}>
      {split ? (
        <ThreadPicker value={picker}>
          <ThreadListPane openId={id} />
        </ThreadPicker>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <DetailPane value={split}>{children}</DetailPane>
      </View>
    </View>
  )
}

const PAGE = 30

function ThreadListPane({ openId }: { openId: string }) {
  const { c } = useTheme()
  const t = useT()
  const say = useSay()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const store = useStore()
  const { chats, projects, computers } = store
  const [limit, setLimit] = useState(PAGE)
  const multi = computers.length > 1
  // `project · host`, as the full list labels threads from every project; the host only once there is more than one.
  const labelOf = (chat: Chat) =>
    [
      chat.projectId === STANDALONE
        ? translate(store.language, 'Standalone')
        : projects.find((p) => p.computerId === chat.computerId && p.id === chat.projectId)?.name,
      multi ? computers.find((x) => x.id === chat.computerId)?.name : undefined,
    ]
      .filter(Boolean)
      .join(' · ') || undefined
  const list = useMemo(() => paneThreads(chats, openId, limit), [chats, openId, limit])
  type PaneRow =
    { key: string; kind: 'label'; text: string } | { key: string; kind: 'chat'; chat: Chat; first: boolean }
  const rows: PaneRow[] = [
    ...(list.pinned.length
      ? [
          { key: 'label:pinned', kind: 'label', text: translate(store.language, 'Pinned') } as const,
          ...list.pinned.map((chat, i) => ({ key: chat.id, kind: 'chat', chat, first: i === 0 }) as const),
        ]
      : []),
    ...(list.pinned.length && list.recent.length
      ? [{ key: 'label:recent', kind: 'label', text: translate(store.language, 'Recent threads') } as const]
      : []),
    ...list.recent.map((chat, i) => ({ key: chat.id, kind: 'chat', chat, first: i === 0 }) as const),
  ]
  return (
    <View
      style={{
        width: LIST_PANE_WIDTH,
        borderRightWidth: StyleSheet.hairlineWidth,
        borderRightColor: c.lineStrong,
        backgroundColor: c.window,
      }}
    >
      <View
        style={{
          paddingTop: insets.top + space.s,
          paddingBottom: space.s,
          paddingLeft: Math.max(space.s, insets.left),
          paddingRight: space.s,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.xs,
          minHeight: insets.top + 56 + space.s * 2,
        }}
      >
        <IconButton icon={ChevronLeft} label={say('Back')} tone="text" onPress={() => goBackOrHome(router)} />
        <T size={font.heading} weight="700" numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">
          {t.chats}
        </T>
        <IconButton icon={Search} label={t.search} tone="text" onPress={() => router.push('/search')} />
        <IconButton icon={SquarePen} label={t.newChat} tone="text" onPress={() => router.push('/new')} />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.l }}
        renderItem={({ item }) =>
          item.kind === 'label' ? (
            <SectionLabel>{item.text}</SectionLabel>
          ) : (
            <ChatRow chat={item.chat} project={labelOf(item.chat)} divider={!item.first} />
          )
        }
        ListEmptyComponent={
          <T tone="muted" style={{ padding: space.l }}>
            {say('No threads yet')}
          </T>
        }
        ListFooterComponent={
          list.more ? (
            <View style={{ padding: space.l, alignItems: 'flex-start' }}>
              <Button kind="ghost" title={say('Show more')} onPress={() => setLimit((n) => n + PAGE)} />
            </View>
          ) : undefined
        }
      />
    </View>
  )
}
