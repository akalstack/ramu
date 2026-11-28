import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Platform, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useSharedValue } from 'react-native-reanimated'
import { useLocalSearchParams } from 'expo-router'
import { Trash2, X } from 'lucide-react-native'
import { translate } from '@ramu/shared/i18n'
import type { Aside } from '@ramu/shared/types'
import { font, radius, space, useTheme } from '../../../theme'
import { useChat, useStore } from '../../../runtime/store'
import { canWriteHost, VIEW_ONLY_WRITE_NOTICE } from '../../../runtime/viewerAccess'
import { quotedQuestion, sideChat } from '../../../runtime/sideChat'
import { Header, HeaderButton, PageKeyboardLegendList, Screen } from '../../../components/Screen'
import { ComposerDock, KeyboardLift, useKeyboardHeight } from '../../../components/Keyboard'
import { Markdown } from '../../../components/Markdown'
import { T } from '../../../components/ui'
import { Composer, type ModelChoice } from '../../../components/Composer'

const RowSeparator = () => <View style={{ height: space.m }} />

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
  // The list keeps its end above the message box and the keyboard itself, as the thread's transcript does.
  const endInset = useSharedValue(96 + space.s)
  const keyboardSlack = Platform.OS === 'ios' ? Math.max(0, insets.bottom - space.s) : -space.s
  const [asides, setAsides] = useState<Aside[]>([])
  const [busy, setBusy] = useState(false)
  // A model and login picked here with the thread's own picker; until then the thread's choice (or Settings' model for
  // asides) answers. It lasts while this screen is open, so a follow-up keeps it.
  const [picked, setPicked] = useState<ModelChoice | null>(null)
  const computerId = chat?.computerId,
    sessionId = chat?.sessionId
  const say = (text: string) => translate(store.language, text)

  const load = useCallback(async () => {
    if (!computerId || !sessionId) return
    setAsides(await store.invoke(computerId, 'aside.list', sessionId))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [computerId, sessionId] by design; the values it reads beyond these are current as of that run
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [computerId, sessionId, load] by design; the values it reads beyond these are current as of that run
  }, [computerId, sessionId, load])

  // While the thread loads, the bar already has its final shape (title, subtitle and Clear), so nothing in it moves or
  // pops in when the side chat arrives.
  if (!chat || !sessionId)
    return (
      <Screen>
        <Header
          title={say('Side questions')}
          subtitle={chat?.title ?? ' '}
          right={
            <HeaderButton
              icon={Trash2}
              label={say('Clear side chat')}
              systemIcon="trash"
              actionId="clear-side-chat"
              disabled
            />
          }
        />
      </Screen>
    )
  const viewOnly = store.computers.find((host) => host.id === chat.computerId)?.access === 'viewer'
  const writable = () => canWriteHost(latestStore.current.computers.find((host) => host.id === chat.computerId))
  const { messages, continueId, waiting } = sideChat(asides)
  const latest = asides.find((aside) => aside.id === continueId)
  // The model waiting in the thread's composer for its next message, as the desktop's aside follows the thread's pick.
  const pending = (() => {
    const stored = store.drafts?.[`${chat.computerId}:chat:${chat.taskId || chat.id}:model`]
    try {
      const model = stored ? (JSON.parse(stored) as ModelChoice) : null
      return model && typeof model.provider === 'string' ? model : null
    } catch {
      return null
    }
  })()
  const thread: ModelChoice = pending ?? {
    provider: chat.provider,
    model: chat.model,
    effort: chat.effort,
    settings: chat.settings,
  }
  const chosen = picked ?? pending
  const ask = async (text: string, attachments: string[] = []) => {
    const question = text.trim() || (attachments.length ? say('What is in the attached files?') : '')
    if (!writable() || !question || busy) return false
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
        latest ? quotedQuestion(question, pendingQuote) : question,
        undefined,
        {
          ...(chosen
            ? {
                model: {
                  provider: chosen.provider,
                  model: chosen.model,
                  effort: (chosen.effort || null) as import('@ramu/shared/types').ReasoningEffort | null,
                  ...(chosen.settings?.accountId ? { accountId: chosen.settings.accountId } : {}),
                },
              }
            : {}),
          ...(attachments.length ? { attachmentIds: attachments } : {}),
        },
      )
      setPendingQuote('')
      await load()
    } catch (error) {
      Alert.alert(say('Could not ask'), error instanceof Error ? error.message : String(error))
      return false
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
          viewOnly ? null : (
            // Always in the bar, usable once there is something to clear, rather than appearing with the first answer.
            <HeaderButton
              icon={Trash2}
              label={say('Clear side chat')}
              systemIcon="trash"
              actionId="clear-side-chat"
              disabled={!messages.length}
              onPress={clear}
            />
          )
        }
      />
      <View style={{ flex: 1 }}>
        <PageKeyboardLegendList
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item: m }) =>
            m.role === 'user' ? (
              <View style={{ gap: space.s, alignItems: 'flex-end' }}>
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
            ) : m.error ? (
              <T tone="bad">{m.text}</T>
            ) : (
              <Markdown text={m.text} />
            )
          }
          getItemType={(m) => m.role}
          contentInsetEndAdjustment={endInset}
          keyboardOffset={keyboardSlack}
          keyboardLiftBehavior="whenAtEnd"
          contentInsetAdjustmentBehavior="automatic"
          estimatedItemSize={120}
          initialScrollAtEnd
          alignItemsAtEnd
          // While the end is in view a new answer keeps it there; a reader scrolled up among older ones stays put.
          maintainScrollAtEnd={{ animated: false, on: { dataChange: true, itemLayout: true, layout: true } }}
          maintainScrollAtEndThreshold={0}
          ItemSeparatorComponent={RowSeparator}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: space.l }}
          ListEmptyComponent={
            <T size={font.control} tone="muted">
              {say('Ask about this thread without interrupting it. The agent never sees these.')}
            </T>
          }
          ListFooterComponent={
            waiting || viewOnly ? (
              <View style={{ gap: space.m, paddingTop: messages.length ? space.m : 0 }}>
                {waiting ? <ActivityIndicator style={{ alignSelf: 'flex-start' }} color={c.accent} /> : null}
                {viewOnly ? <T tone="muted">{VIEW_ONLY_WRITE_NOTICE[store.language]}</T> : null}
              </View>
            ) : null
          }
        />
        <KeyboardLift keyboard={keyboard}>
          <ComposerDock onLayout={(event) => endInset.set(event.nativeEvent.layout.height + space.s)}>
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
              {/* The thread's own composer, with its files and its model and login picker, focused on the side question. */}
              <Composer
                computerId={chat.computerId}
                scope={chat.taskId || undefined}
                draftKey={`${chat.computerId}:aside:${sessionId}`}
                running={false}
                model={picked ?? thread}
                onModel={setPicked}
                onSend={(text, _mode, attachments) => ask(text, attachments)}
                placeholder={say(messages.length ? 'Ask a follow-up' : 'Ask a side question')}
              />
            </View>
          </ComposerDock>
        </KeyboardLift>
      </View>
    </Screen>
  )
}
