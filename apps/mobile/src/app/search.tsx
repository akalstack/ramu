import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, TextInput, View } from 'react-native'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import type { SearchBarCommands } from 'react-native-screens'
import type { ChatSearchHit } from '@ramu/shared/types'
import { Search } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { STANDALONE, type Chat } from '../runtime/types'
import { useSay, useT } from '../i18n'
import { Header, PageLegendList, Screen } from '../components/Screen'
import { ChatRow } from '../components/ChatRow'
import { useTabActions } from '../components/Overlays'
import { Nothing, Section } from '../components/InboxParts'
import { Button, Divider, Row, T } from '../components/ui'

const RECENT = 10
/** Message hits each host sends at a time. */
const MESSAGE_PAGE = 20

type SearchRow =
  | { kind: 'head'; key: string; title: string; count: number }
  | { kind: 'chat'; key: string; chat: Chat; divider: boolean }
  | { kind: 'hit'; key: string; chat: Chat; hit: ChatSearchHit; divider: boolean }
  | { kind: 'more'; key: string }

/** Threads on every paired computer, found by title, last message, project or computer. */
export default function SearchScreen() {
  const { c } = useTheme()
  const t = useT()
  const say = useSay()
  const store = useStore()
  const router = useRouter()
  const actions = useTabActions(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<{ query: string; computerId: string; hit: ChatSearchHit }[]>([])
  const search = useRef<SearchBarCommands>(null)
  // Focus after the search header attaches on every visit.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') return
      const frame = requestAnimationFrame(() => search.current?.focus())
      return () => {
        cancelAnimationFrame(frame)
        search.current?.blur()
      }
    }, []),
  )
  const multi = store.computers.length > 1
  const label = (computerId: string, projectId: string) =>
    [
      projectId === STANDALONE
        ? undefined
        : store.projects.find((p) => p.computerId === computerId && p.id === projectId)?.name,
      multi ? store.computers.find((pc) => pc.id === computerId)?.name : undefined,
    ]
      .filter(Boolean)
      .join(' · ')
  const q = query.trim().toLowerCase()
  const results = useMemo(() => {
    const all = store.chats.filter((chat) => !chat.pending).sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    if (!q) return all.filter((chat) => chat.status !== 'archived').slice(0, RECENT)
    return all.filter(
      (chat) =>
        chat.title.toLowerCase().includes(q) ||
        chat.preview.toLowerCase().includes(q) ||
        label(chat.computerId, chat.projectId).toLowerCase().includes(q) ||
        (store.computers.find((pc) => pc.id === chat.computerId)?.name ?? '').toLowerCase().includes(q),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [store.chats, store.projects, store.computers, q] by design; the values it reads beyond these are current as of that run
  }, [store.chats, store.projects, store.computers, q])
  // What was said inside threads, searched by each online computer.
  const online = store.computers
    .filter((pc) => pc.status === 'online')
    .map((pc) => pc.id)
    .join(',')
  // Each host's next page of message hits for the search they came from, so Show more messages continues every host
  // that has more, and a page for an earlier search is dropped.
  const [cursors, setCursors] = useState<{ query: string; next: Record<string, string> }>({ query: '', next: {} })
  const [loadingMore, setLoadingMore] = useState(false)
  const searchPage = (computerId: string, cursor: string | null) =>
    store
      .invoke(computerId, 'agent.searchMessagesPage', q, cursor, MESSAGE_PAGE)
      .catch(async (error: unknown) => {
        // A host too old to page answers its first page the old way, with nothing after it.
        if (cursor) throw error
        return { items: await store.invoke(computerId, 'agent.searchMessages', q), next: null }
      })
      .then((page) => ({ computerId, page }))
  useEffect(() => {
    setCursors({ query: q, next: {} })
    if (q.length < 2 || !online) {
      setHits([])
      return
    }
    let alive = true
    const timer = setTimeout(() => {
      void Promise.all(online.split(',').map((computerId) => searchPage(computerId, null).catch(() => null))).then(
        (pages) => {
          if (!alive) return
          const found = pages.filter((entry) => entry !== null)
          setHits(found.flatMap(({ computerId, page }) => page.items.map((hit) => ({ query: q, computerId, hit }))))
          setCursors({
            query: q,
            next: Object.fromEntries(
              found.flatMap(({ computerId, page }) => (page.next ? [[computerId, page.next]] : [])),
            ),
          })
        },
      )
    }, 300)
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [q, online] by design; the values it reads beyond these are current as of that run
  }, [q, online])
  const pending = cursors.query === q ? cursors.next : {}
  const moreMessages = () => {
    if (loadingMore) return
    const asked = q
    setLoadingMore(true)
    void Promise.all(
      Object.entries(pending).map(([computerId, cursor]) => searchPage(computerId, cursor).catch(() => null)),
    )
      .then((pages) => {
        const found = pages.filter((entry) => entry !== null)
        // Hits keep the search they answer, so ones for an earlier search never show under a newer one.
        setHits((shown) => [
          ...shown,
          ...found.flatMap(({ computerId, page }) => page.items.map((hit) => ({ query: asked, computerId, hit }))),
        ])
        setCursors((current) => {
          if (current.query !== asked) return current
          const next = { ...current.next }
          for (const { computerId, page } of found)
            if (page.next) next[computerId] = page.next
            else delete next[computerId]
          return { query: asked, next }
        })
      })
      .finally(() => setLoadingMore(false))
  }
  const messageHits = hits.flatMap(({ query: searchedQuery, computerId, hit }) => {
    if (searchedQuery !== q || !q) return []
    const chat = store.chats.find((x) => x.computerId === computerId && x.taskId === hit.taskId)
    return chat ? [{ chat, hit }] : []
  })
  // Matching threads, then the messages that matched, each under its heading, in one list that mounts only the rows
  // near the screen.
  const rows: SearchRow[] = [
    ...(results.length
      ? [
          { kind: 'head' as const, key: 'head:threads', title: q ? t.chats : t.recent, count: q ? results.length : 0 },
          ...results.map((chat, i) => ({ kind: 'chat' as const, key: `chat:${chat.id}`, chat, divider: i > 0 })),
        ]
      : []),
    ...(messageHits.length
      ? [
          { kind: 'head' as const, key: 'head:messages', title: t.inMessages, count: messageHits.length },
          ...messageHits.map(({ chat, hit }, i) => ({
            kind: 'hit' as const,
            key: `hit:${chat.id}:${hit.sessionId}:${hit.seq}`,
            chat,
            hit,
            divider: i > 0,
          })),
          ...(Object.keys(pending).length ? [{ kind: 'more' as const, key: 'more' }] : []),
        ]
      : []),
  ]
  const renderRow = (row: SearchRow) => {
    if (row.kind === 'head') return <Section title={row.title} count={row.count || undefined} />
    if (row.kind === 'chat')
      return <ChatRow chat={row.chat} project={label(row.chat.computerId, row.chat.projectId)} divider={row.divider} />
    if (row.kind === 'more')
      return <Button kind="ghost" title={say('Show more messages')} disabled={loadingMore} onPress={moreMessages} />
    const { chat, hit } = row
    return (
      <View>
        {row.divider ? <Divider inset={space.l} /> : null}
        <Row
          onPress={() => router.push({ pathname: '/chat/[id]', params: { id: chat.id } })}
          style={{ paddingVertical: 11 }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <T weight="500" numberOfLines={1}>
              {chat.title}
            </T>
            <T size={font.control} tone="muted" numberOfLines={2}>
              {hit.snippet}
            </T>
          </View>
        </Row>
      </View>
    )
  }
  return (
    <Screen>
      <Header large title={t.search} right={actions} />
      {/* Keep search in the native navigation bar. */}
      {Platform.OS === 'web' ? null : (
        <Stack.SearchBar
          ref={search}
          autoFocus={Platform.OS === 'android'}
          headerIconColor={c.text}
          placeholder={t.search}
          textColor={c.text}
          hintTextColor={c.muted}
          tintColor={c.accent}
          autoCapitalize="none"
          onChangeText={(event) => setQuery(event.nativeEvent.text)}
          onCancelButtonPress={() => setQuery('')}
        />
      )}
      {Platform.OS === 'ios' ? (
        <Stack.Toolbar placement="bottom">
          <Stack.Toolbar.SearchBarSlot />
        </Stack.Toolbar>
      ) : null}
      <PageLegendList
        fullWidth
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item }) => renderRow(item)}
        getItemType={(row) => row.kind}
        estimatedItemSize={64}
        // The Show more button turns off while a page loads, which its row's data does not carry.
        extraData={loadingMore}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: space.xl * 2 }}
        ListHeaderComponent={
          Platform.OS === 'web' ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.s,
                margin: space.l,
                paddingHorizontal: space.l,
                height: 44,
                borderRadius: radius.full,
                backgroundColor: c.raised,
              }}
            >
              <Search size={16} color={c.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t.search}
                placeholderTextColor={c.placeholder}
                style={{ flex: 1, color: c.text, fontSize: font.body }}
              />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <Nothing icon={Search} title={q ? t.searchEmpty : t.search} detail={q ? '' : t.searchHint} />
        }
      />
    </Screen>
  )
}
