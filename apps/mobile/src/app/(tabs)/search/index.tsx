import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, TextInput, View } from 'react-native'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import type { SearchBarCommands } from 'react-native-screens'
import type { ChatSearchHit } from '@ramu/shared/types'
import { Search } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../../../theme'
import { useStore } from '../../../runtime/store'
import { STANDALONE } from '../../../runtime/types'
import { useT } from '../../../i18n'
import { Header, PageScrollView, Screen } from '../../../components/Screen'
import { ChatRow } from '../../../components/ChatRow'
import { useTabActions } from '../../../components/Overlays'
import { Group, Nothing, Section } from '../../../components/InboxParts'
import { Row, T } from '../../../components/ui'

const RECENT = 10

/** Threads on every paired computer, found by title, last message, project or computer. */
export default function SearchScreen() {
  const { c } = useTheme()
  const t = useT()
  const store = useStore()
  const router = useRouter()
  const actions = useTabActions()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<{ computerId: string; hit: ChatSearchHit }[]>([])
  const search = useRef<SearchBarCommands>(null)
  // Native tabs retain this screen. Focus after the header attaches on every visit.
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
  }, [store.chats, store.projects, store.computers, q])
  // What was said inside threads, searched by each online computer.
  const online = store.computers
    .filter((pc) => pc.status === 'online')
    .map((pc) => pc.id)
    .join(',')
  useEffect(() => {
    if (q.length < 2 || !online) {
      setHits([])
      return
    }
    let alive = true
    const timer = setTimeout(() => {
      void Promise.all(
        online.split(',').map((computerId) =>
          store
            .invoke(computerId, 'agent.searchMessages', q)
            .then((found) => found.map((hit) => ({ computerId, hit })))
            .catch(() => []),
        ),
      ).then((all) => alive && setHits(all.flat().slice(0, 30)))
    }, 300)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [q, online])
  const messageHits = hits.flatMap(({ computerId, hit }) => {
    const chat = store.chats.find((x) => x.computerId === computerId && x.taskId === hit.taskId)
    return chat ? [{ chat, hit }] : []
  })
  return (
    <Screen>
      <Header back={false} large title={t.search} right={actions} />
      {/* The native search field lives in the navigation bar (and on iOS 26 is the Search tab itself). */}
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
      <PageScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: space.xl * 2 }}
      >
        {Platform.OS === 'web' ? (
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
        ) : null}
        {results.length ? (
          <Section title={q ? t.chats : t.recent} count={q ? results.length : undefined}>
            <Group>
              {results.map((chat, i) => (
                <ChatRow key={chat.id} chat={chat} project={label(chat.computerId, chat.projectId)} divider={i > 0} />
              ))}
            </Group>
          </Section>
        ) : !messageHits.length ? (
          <Nothing icon={Search} title={q ? t.searchEmpty : t.search} detail={q ? '' : t.searchHint} />
        ) : null}
        {messageHits.length ? (
          <Section title={t.inMessages} count={messageHits.length}>
            <Group>
              {messageHits.map(({ chat, hit }, i) => (
                <Row
                  key={`${chat.id}:${hit.sessionId}:${hit.seq}`}
                  onPress={() => router.push({ pathname: '/chat/[id]', params: { id: chat.id } })}
                  style={{ paddingVertical: 11, borderTopWidth: i ? 0.5 : 0, borderTopColor: c.lineStrong }}
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
              ))}
            </Group>
          </Section>
        ) : null}
      </PageScrollView>
    </Screen>
  )
}
