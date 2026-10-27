import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Platform, Pressable, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { ArrowUp, Trash2, X } from 'lucide-react-native'
import { translate } from '@ramu/shared/i18n'
import type { Aside } from '@ramu/shared/types'
import { font, radius, space, useTheme } from '../../../theme'
import { useChat, useStore } from '../../../runtime/store'
import { canWriteHost, VIEW_ONLY_WRITE_NOTICE } from '../../../runtime/viewerAccess'
import { quotedQuestion, sideChat } from '../../../runtime/sideChat'
import { Header, HeaderButton, PageScrollView as ScrollView, Screen } from '../../../components/Screen'
import { ComposerDock, KeyboardLift, useKeyboardHeight } from '../../../components/Keyboard'
import { Markdown } from '../../../components/Markdown'
import { Glass } from '../../../components/Glass'
import { T, tap } from '../../../components/ui'

/**
 * One side chat per thread, like Claude's /btw: ask about the work without interrupting it (the agent never sees these),
 * keep asking in the same conversation, and clear it with the trash button when done.
 */
export default function AsideScreen() {
  const {
    id,
    quote: quoteParam,
    from,
  } = useLocalSearchParams<{
    id: string
    quote?: string
    from?: 'user' | 'assistant'
  }>()
  // Opened from a long-pressed message: the next question is about that passage.
  const [pendingQuote, setPendingQuote] = useState(quoteParam ?? '')
  const chat = useChat(id)
  const store = useStore()
  const latestStore = useRef(store)
  latestStore.current = store
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboardHeight()
  const [composerHeight, setComposerHeight] = useState(96)
  const ios = Platform.OS === 'ios'
  const cover =
    composerHeight + (keyboard.height ? Math.max(0, keyboard.height - Math.max(0, insets.bottom - space.s)) : 0)
  const viewport = useRef({ content: 0, height: 0 })
  const following = useRef(true)
  const toEnd = useCallback(
    (animated = true) => {
      const { content, height } = viewport.current
      if (!height) return
      if (ios) scroll.current?.scrollTo({ y: Math.max(0, content - height + cover), animated })
      else scroll.current?.scrollToEnd({ animated })
    },
    [ios, cover],
  )
  useEffect(() => {
    if (!following.current) return
    const frame = requestAnimationFrame(() => toEnd())
    return () => cancelAnimationFrame(frame)
  }, [toEnd])
  const [asides, setAsides] = useState<Aside[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const scroll = useRef<import('react-native').ScrollViewInstance>(null)
  const computerId = chat?.computerId,
    sessionId = chat?.sessionId
  const say = (text: string) => translate(store.language, text)

  const load = useCallback(async () => {
    if (!computerId || !sessionId) return
    setAsides(await store.invoke(computerId, 'aside.list', sessionId))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes only when the listed dependencies change
  }, [computerId, sessionId])
  useEffect(() => {
    void load().catch(() => {})
    if (!computerId) return
    const unwatch = sessionId ? store.watch(computerId, ['aside:changed'], { 'aside:changed': [sessionId] }) : () => {}
    const off = store.subscribe(computerId, (channel, payload) => {
      if (channel === 'aside:changed' && payload.sessionId === sessionId) void load().catch(() => {})
    })
    return () => {
      off()
      unwatch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when the listed dependencies change; other values are read as of that change
  }, [computerId, sessionId, load])

  if (!chat || !sessionId)
    return (
      <Screen>
        <Header title={say('Side questions')} />
      </Screen>
    )
  const viewOnly = store.computers.find((host) => host.id === chat.computerId)?.access === 'viewer'
  const writable = () => canWriteHost(latestStore.current.computers.find((host) => host.id === chat.computerId))
  const { messages, continueId, waiting } = sideChat(asides)
  const latest = asides.find((aside) => aside.id === continueId)
  const ask = async () => {
    const text = question.trim()
    if (!writable() || !text || busy) return
    setBusy(true)
    try {
      // The first question carries its quote natively; later ones continue the same aside with the quote inline.
      await store.invoke(
        chat.computerId,
        'aside.ask',
        sessionId,
        latest?.id ?? null,
        latest ? latest.quote : pendingQuote,
        latest ? latest.quoteFrom : (from ?? 'assistant'),
        latest ? quotedQuestion(text, pendingQuote) : text,
      )
      setQuestion('')
      setPendingQuote('')
      await load()
    } catch (error) {
      Alert.alert(say('Could not ask'), error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const clear = () => {
    if (!writable() || !asides.length) return
    Alert.alert(say('Clear side chat?'), say('The thread itself is not affected.'), [
      { text: say('Cancel'), style: 'cancel' },
      {
        text: say('Clear'),
        style: 'destructive',
        onPress: () => {
          if (!writable()) return
          const ids = asides.map((aside) => aside.id)
          void Promise.all(
            ids.map((asideId) => latestStore.current.invoke(chat.computerId, 'aside.delete', sessionId, asideId)),
          )
            .then(load)
            .catch(() => {})
        },
      },
    ])
  }
  const quoteBlock = (text: string, lines = 6) => (
    <View style={{ borderLeftWidth: 2, borderLeftColor: c.lineStrong, paddingLeft: space.m }}>
      <T size={font.control} tone="muted" numberOfLines={lines}>
        {text}
      </T>
    </View>
  )
  return (
    <Screen>
      <Header
        title={say('Side questions')}
        subtitle={chat.title}
        right={
          messages.length > 0 && !viewOnly ? (
            <HeaderButton
              icon={Trash2}
              label={say('Clear side chat')}
              systemIcon="trash"
              actionId="clear-side-chat"
              onPress={clear}
            />
          ) : null
        }
      />
      <View style={{ flex: 1 }}>
        <ScrollView
          ref={scroll}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets={false}
          style={{ flex: 1 }}
          contentInset={ios ? { bottom: cover } : undefined}
          scrollIndicatorInsets={ios ? { bottom: cover } : undefined}
          onLayout={(event) => {
            viewport.current.height = event.nativeEvent.layout.height
            if (following.current) toEnd(false)
          }}
          onContentSizeChange={(_width, height) => {
            viewport.current.content = height
            if (following.current) toEnd()
          }}
          onScrollBeginDrag={() => {
            following.current = false
          }}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
            const gap = contentSize.height - layoutMeasurement.height + (ios ? cover : 0) - contentOffset.y
            if (gap < 40) following.current = true
          }}
          scrollEventThrottle={16}
          contentContainerStyle={{ padding: space.l, gap: space.m, paddingBottom: ios ? space.xl : cover + space.xl }}
        >
          {!messages.length ? (
            <T size={font.control} tone="muted">
              {say('Ask about this thread without interrupting it. The agent never sees these.')}
            </T>
          ) : null}
          {messages.map((m) =>
            m.role === 'user' ? (
              <View key={m.id} style={{ gap: space.s, alignItems: 'flex-end' }}>
                {m.quote ? <View style={{ alignSelf: 'stretch' }}>{quoteBlock(m.quote, 4)}</View> : null}
                <View
                  style={{
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
              </View>
            ) : (
              <View key={m.id}>{m.error ? <T tone="bad">{m.text}</T> : <Markdown text={m.text} />}</View>
            ),
          )}
          {waiting ? <ActivityIndicator style={{ alignSelf: 'flex-start' }} color={c.accent} /> : null}
          {viewOnly ? <T tone="muted">{VIEW_ONLY_WRITE_NOTICE[store.language]}</T> : null}
        </ScrollView>
        <KeyboardLift keyboard={keyboard}>
          <ComposerDock onLayout={(event) => setComposerHeight(event.nativeEvent.layout.height)}>
            <View style={{ paddingHorizontal: space.s + 2, gap: space.s }}>
              {pendingQuote ? (
                // The passage the next question is about, removable before sending.
                <View
                  style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s, paddingHorizontal: space.s }}
                >
                  <View style={{ flex: 1 }}>{quoteBlock(pendingQuote, 3)}</View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={say('Remove quote')}
                    hitSlop={8}
                    onPress={() => setPendingQuote('')}
                  >
                    <X size={16} color={c.muted} />
                  </Pressable>
                </View>
              ) : null}
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
                    placeholder={say(messages.length ? 'Ask a follow-up' : 'Ask a side question')}
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
                    accessibilityLabel={say('Ask')}
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
          </ComposerDock>
        </KeyboardLift>
      </View>
    </Screen>
  )
}
