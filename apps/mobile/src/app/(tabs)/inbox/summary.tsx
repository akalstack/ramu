import { goBackOrHome } from '../../../runtime/navigation'
import { useEffect, useState } from 'react'
import { ActivityIndicator, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Brain, MessageSquare, Send, Sparkles } from 'lucide-react-native'
import type { LibrarySummary, LibrarySummaryItem } from '@ramu/shared/types'
import { font, radius, space, useTheme } from '../../../theme'
import { useStore } from '../../../runtime/store'
import { useAutomation } from '../../../runtime/automation'
import { useT, useSay } from '../../../i18n'
import { Header, PageScrollView, Screen } from '../../../components/Screen'
import { Markdown } from '../../../components/Markdown'
import { Group } from '../../../components/InboxParts'
import { IconButton, Row, SectionLabel, T, tap } from '../../../components/ui'

const ORDER: LibrarySummaryItem['change'][] = ['added', 'updated', 'merged', 'archived', 'restored']
const LABEL: Record<LibrarySummaryItem['change'], string> = {
  added: 'Added',
  updated: 'Updated',
  merged: 'Merged',
  archived: 'Archived',
  restored: 'Restored',
}

function period(summary: LibrarySummary) {
  const day = (at: number) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${day(summary.periodStart)} – ${day(summary.periodEnd)}`
}

/** One summary of what Ramu learned: the text, the memories and skills it touched, and a box that starts a thread about it. */
export default function SummaryScreen() {
  const say = useSay()
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const store = useStore()
  const auto = useAutomation()
  const { computer, id } = useLocalSearchParams<{ computer: string; id: string }>()
  const [summary, setSummary] = useState<LibrarySummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    // Reading marks it read on the computer; the list behind this screen then drops its unread dot.
    auto
      .readSummary(computer, id)
      .then((value) => {
        if (alive) setSummary(value)
        void auto.reload(computer)
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [computer, id] by design; the values it reads beyond these are current as of that run
  }, [computer, id])

  const send = async () => {
    const message = text.trim()
    if (!message || busy) return
    tap()
    setBusy(true)
    setError(null)
    try {
      const started = await auto.discussSummary(computer, id, message, store.defaults[computer])
      await store.refresh(computer)
      setText('')
      router.push({ pathname: '/chat/[id]', params: { id: store.resolveChat(computer, started.taskId) } })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const dismiss = async () => {
    setBusy(true)
    try {
      await auto.dismissSummary(computer, id)
      goBackOrHome(router)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }
  const groups = summary
    ? ORDER.map((change) => ({ change, items: summary.items.filter((item) => item.change === change) })).filter(
        (group) => group.items.length,
      )
    : []
  const threads = summary
    ? summary.chatIds.flatMap((taskId) =>
        store.chats.filter((chat) => chat.computerId === computer && chat.taskId === taskId),
      )
    : []
  return (
    <Screen>
      <Header title={t.whatLearned} subtitle={summary ? period(summary) : undefined} />
      <PageScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{ padding: space.l, paddingBottom: space.xl * 2, gap: space.m }}
      >
        {!summary && !error ? <ActivityIndicator style={{ margin: space.xl }} /> : null}
        {error ? (
          <T tone="bad" size={font.control}>
            {error}
          </T>
        ) : null}
        {summary ? (
          <>
            <Markdown text={summary.text} />
            {summary.changedByYou ? (
              <T tone="muted" size={font.caption}>
                {summary.changedByYou}
              </T>
            ) : null}
            {groups.map((group) => (
              <View key={group.change}>
                <SectionLabel>{LABEL[group.change]}</SectionLabel>
                <Group flush>
                  {group.items.map((item) => (
                    <Row key={`${item.kind}:${item.id}`} disabled style={{ paddingVertical: 10 }}>
                      {item.kind === 'memory' ? (
                        <Brain size={15} color={c.muted} />
                      ) : (
                        <Sparkles size={15} color={c.muted} />
                      )}
                      <View style={{ flex: 1 }}>
                        <T numberOfLines={2}>{item.title}</T>
                        {item.reason ? (
                          <T size={font.caption} tone="muted" numberOfLines={3}>
                            {item.reason}
                          </T>
                        ) : null}
                      </View>
                      {item.worthALook ? (
                        <T size={font.caption} tone="warn">
                          {t.worthALook}
                        </T>
                      ) : null}
                    </Row>
                  ))}
                </Group>
              </View>
            ))}
            {threads.length ? (
              <View>
                <SectionLabel>{t.discussedIn}</SectionLabel>
                <Group flush>
                  {threads.map((chat) => (
                    <Row
                      key={chat.id}
                      onPress={() => router.push({ pathname: '/chat/[id]', params: { id: chat.id } })}
                      style={{ paddingVertical: 10 }}
                    >
                      <MessageSquare size={15} color={c.muted} />
                      <T style={{ flex: 1 }} numberOfLines={1}>
                        {chat.title}
                      </T>
                    </Row>
                  ))}
                </Group>
              </View>
            ) : null}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-end',
                gap: space.s,
                marginTop: space.m,
                padding: space.s,
                paddingLeft: space.l,
                borderRadius: radius.l,
                backgroundColor: c.raised2,
              }}
            >
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={t.discuss}
                placeholderTextColor={c.placeholder}
                multiline
                maxLength={100_000}
                style={{ flex: 1, color: c.text, fontSize: font.body, maxHeight: 140, paddingVertical: 8 }}
              />
              <IconButton
                icon={Send}
                label={say('Send')}
                size={40}
                filled
                tone={text.trim() ? 'accent' : 'muted'}
                onPress={() => void send()}
              />
            </View>
            {summary.status !== 'dismissed' ? (
              <Row onPress={() => void dismiss()} disabled={busy} style={{ justifyContent: 'center' }}>
                <T tone="accent" weight="600">
                  {t.looksGood}
                </T>
              </Row>
            ) : null}
          </>
        ) : null}
      </PageScrollView>
    </Screen>
  )
}
