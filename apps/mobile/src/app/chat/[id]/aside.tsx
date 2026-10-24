import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, KeyboardAvoidingView, Pressable, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { ArrowUp, Plus, Trash2 } from 'lucide-react-native'
import type { Aside } from '@ramu/shared/types'
import { font, radius, space, useTheme } from '../../../theme'
import { useChat, useStore } from '../../../runtime/store'
import { canWriteHost, VIEW_ONLY_WRITE_NOTICE } from '../../../runtime/viewerAccess'
import { Header, HeaderButton, PageScrollView as ScrollView, Screen } from '../../../components/Screen'
import { Markdown } from '../../../components/Markdown'
import { Glass } from '../../../components/Glass'
import { Chip, T, tap } from '../../../components/ui'

/** Side questions about a chat, as on the desktop: the agent keeps working and never sees them. */
export default function AsideScreen() {
  const {
    id,
    aside: initial,
    quote: quoteParam,
    from,
  } = useLocalSearchParams<{ id: string; aside?: string; quote?: string; from?: 'user' | 'assistant' }>()
  // Opened from a long-pressed message: a new aside about that passage.
  const [pendingQuote, setPendingQuote] = useState(quoteParam ?? '')
  const chat = useChat(id)
  const store = useStore()
  const latestStore = useRef(store)
  latestStore.current = store
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const [asides, setAsides] = useState<Aside[]>([])
  const [selected, setSelected] = useState<string | null>(quoteParam ? null : (initial ?? null))
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const scroll = useRef<import('react-native').ScrollViewInstance>(null)
  const computerId = chat?.computerId,
    sessionId = chat?.sessionId

  const load = useCallback(async () => {
    if (!computerId || !sessionId) return
    const list = await store.invoke(computerId, 'aside.list', sessionId)
    setAsides(list)
    setSelected((current) =>
      current && list.some((a) => a.id === current)
        ? current
        : initial && list.some((a) => a.id === initial)
          ? initial
          : list.length === 1
            ? list[0]!.id
            : current && !list.some((a) => a.id === current)
              ? null
              : current,
    )
  }, [computerId, sessionId])
  useEffect(() => {
    void load().catch(() => {})
    if (!computerId) return
    return store.subscribe(computerId, (channel, payload) => {
      if (channel === 'aside:changed' && payload.sessionId === sessionId) void load().catch(() => {})
    })
  }, [computerId, sessionId, load])

  if (!chat || !sessionId)
    return (
      <Screen>
        <Header title="Side questions" />
      </Screen>
    )
  const viewOnly = store.computers.find((host) => host.id === chat.computerId)?.access === 'viewer'
  const writable = () => canWriteHost(latestStore.current.computers.find((host) => host.id === chat.computerId))
  const current = asides.find((a) => a.id === selected)
  const waiting = current ? current.messages.at(-1)?.role === 'user' : false
  const ask = async () => {
    const text = question.trim()
    if (!writable() || !text || busy) return
    setBusy(true)
    try {
      const made = await store.invoke(
        chat.computerId,
        'aside.ask',
        sessionId,
        current?.id ?? null,
        current ? current.quote : pendingQuote,
        current ? current.quoteFrom : (from ?? 'assistant'),
        text,
      )
      setQuestion('')
      setPendingQuote('')
      setSelected(made.id)
      await load()
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 120)
    } catch (error) {
      Alert.alert('Could not ask', error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const remove = () => {
    if (!writable() || !current) return
    Alert.alert('Delete this side question?', 'The thread itself is not affected.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          writable() &&
          void latestStore.current
            .invoke(chat.computerId, 'aside.delete', sessionId, current.id)
            .then(() => {
              setSelected(null)
              return load()
            })
            .catch(() => {}),
      },
    ])
  }
  return (
    <Screen bg="canvas">
      <Header
        title="Side questions"
        subtitle={chat.title}
        right={
          current && !viewOnly ? (
            <HeaderButton icon={Trash2} label="Delete side question" systemIcon="trash" onPress={remove} />
          ) : null
        }
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView
          ref={scroll}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={{ padding: space.l, gap: space.m, paddingBottom: space.xl }}
        >
          <T size={font.control} tone="muted">
            Ask about this thread without interrupting it. The agent never sees these.
          </T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {asides.map((a) => (
              <Chip
                key={a.id}
                label={(a.quote || a.messages[0]?.text || 'Side question').replace(/\s+/g, ' ').slice(0, 28)}
                selected={a.id === selected}
                onPress={() => setSelected(a.id)}
              />
            ))}
            {!viewOnly ? (
              <Chip
                label="New"
                accessibilityLabel="New side question"
                icon={Plus}
                selected={selected === null}
                onPress={() => setSelected(null)}
              />
            ) : null}
          </View>
          {!current && pendingQuote ? (
            <View style={{ borderLeftWidth: 2, borderLeftColor: c.lineStrong, paddingLeft: space.m }}>
              <T size={font.control} tone="muted" numberOfLines={6}>
                {pendingQuote}
              </T>
            </View>
          ) : null}
          {current?.quote ? (
            <View style={{ borderLeftWidth: 2, borderLeftColor: c.lineStrong, paddingLeft: space.m }}>
              <T size={font.control} tone="muted" numberOfLines={6}>
                {current.quote}
              </T>
            </View>
          ) : null}
          {current?.messages.map((m) =>
            m.role === 'user' ? (
              <View
                key={m.id}
                style={{
                  alignSelf: 'flex-end',
                  maxWidth: '86%',
                  backgroundColor: c.bubble,
                  borderRadius: radius.l - 2,
                  borderBottomRightRadius: radius.xs,
                  paddingHorizontal: space.m + 2,
                  paddingVertical: space.s + 2,
                }}
              >
                <T copyable={m.text} style={{ lineHeight: 21 }}>
                  {m.text}
                </T>
              </View>
            ) : (
              <View key={m.id}>{m.error ? <T tone="bad">{m.text}</T> : <Markdown text={m.text} />}</View>
            ),
          )}
          {waiting ? <ActivityIndicator style={{ alignSelf: 'flex-start' }} color={c.accent} /> : null}
          {viewOnly ? <T tone="muted">{VIEW_ONLY_WRITE_NOTICE[store.language]}</T> : null}
          {!viewOnly && !current && !asides.length ? <T tone="muted">No side questions yet. Ask one below.</T> : null}
        </ScrollView>
        <View style={{ paddingBottom: Math.max(insets.bottom, space.s), paddingHorizontal: space.s + 2 }}>
          <Glass radius={radius.xl}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-end',
                paddingLeft: space.m,
                paddingRight: space.s,
                paddingVertical: space.s,
              }}
            >
              <TextInput
                editable={!viewOnly}
                value={question}
                onChangeText={setQuestion}
                multiline
                placeholder={current ? 'Ask a follow-up' : 'Ask a side question'}
                placeholderTextColor={c.placeholder}
                style={{
                  flex: 1,
                  color: c.text,
                  fontSize: font.body,
                  lineHeight: 21,
                  maxHeight: 120,
                  minHeight: 36,
                  paddingTop: 6,
                  paddingBottom: 6,
                }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Ask"
                disabled={viewOnly || !question.trim() || busy}
                onPress={() => {
                  tap()
                  void ask()
                }}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: radius.full,
                  backgroundColor: question.trim() ? c.primary : c.fill,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ArrowUp size={18} color={question.trim() ? c.primaryInk : c.placeholder} strokeWidth={2.4} />
              </Pressable>
            </View>
          </Glass>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}
