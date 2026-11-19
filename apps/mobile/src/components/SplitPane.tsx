import { useMemo, useState, type ReactNode } from 'react'
import { FlatList, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Search, SquarePen } from 'lucide-react-native'
import { translate } from '@ramu/shared/i18n'
import { space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { STANDALONE, type Chat } from '../runtime/types'
import { paneThreads, showsSplit } from '../runtime/splitLayout'
import { useSay, useT } from '../i18n'
import { ChatRow } from './ChatRow'
import { Button, IconButton, SectionLabel, T } from './ui'
import { DetailPane, ThreadOrigin, ThreadPicker } from './paneContext'
import { InboxList } from './InboxList'
import { ListPane } from './ListPane'

/**
 * An item on a wide window: the list it was picked from on the left, the item on the right. A narrower window shows
 * the item alone, as on a phone. The item keeps its place in the tree either way, so turning the device does not
 * reload it.
 */
export function ListSplit({ pane, children }: { pane: () => ReactNode; children: ReactNode }) {
  const { c } = useTheme()
  const window = useWindowDimensions()
  const split = showsSplit(window.width, window.height)
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: c.window }}>
      {split ? pane() : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <DetailPane value={split}>{children}</DetailPane>
      </View>
    </View>
  )
}

/**
 * A thread beside the list it was opened from: the thread list, or the Inbox for a thread opened there. Picking
 * another thread swaps the right side in place, so moving between threads is one tap and the list keeps its scroll.
 */
export function ThreadSplit({ id, from, children }: { id: string; from?: string; children: ReactNode }) {
  const router = useRouter()
  const picker = useMemo(
    () => ({ openId: id, open: (next: string) => (next === id ? undefined : router.setParams({ id: next })) }),
    [id, router],
  )
  return (
    <ListSplit
      pane={() => (
        <ThreadPicker value={picker}>
          {from === 'inbox' ? (
            <ThreadOrigin value="inbox">
              <InboxList pane />
            </ThreadOrigin>
          ) : (
            <ThreadListPane openId={id} />
          )}
        </ThreadPicker>
      )}
    >
      {children}
    </ListSplit>
  )
}

const PAGE = 30

function ThreadListPane({ openId }: { openId: string }) {
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
    <ListPane
      title={t.chats}
      right={
        <>
          <IconButton icon={Search} label={t.search} tone="text" onPress={() => router.push('/search')} />
          <IconButton icon={SquarePen} label={t.newChat} tone="text" onPress={() => router.push('/new')} />
        </>
      }
    >
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
    </ListPane>
  )
}
