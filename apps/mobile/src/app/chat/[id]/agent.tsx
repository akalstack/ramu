import { useMemo, useRef, useState } from 'react'
import { Alert, Platform, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useSharedValue } from 'react-native-reanimated'
import { useLocalSearchParams } from 'expo-router'
import { Square } from 'lucide-react-native'
import { translate } from '@ramu/shared/i18n'
import { helperConversation } from '@ramu/shared/chat/agentTasks'
import { helperActions, helperActive, helperStatusLabel } from '@ramu/shared/chat/helperPresentation'
import { font, radius, space, useTheme } from '../../../theme'
import { useChat, useStore } from '../../../runtime/store'
import { transcript } from '../../../runtime/transcript'
import { canWriteHost, VIEW_ONLY_WRITE_NOTICE } from '../../../runtime/viewerAccess'
import { Header, HeaderButton, PageKeyboardLegendList, Screen } from '../../../components/Screen'
import { ComposerDock, KeyboardLift, useKeyboardHeight } from '../../../components/Keyboard'
import { BottomFade } from '../../../components/Glass'
import { Composer } from '../../../components/Composer'
import { LoadingDots } from '../../../components/LoadingDots'
import { Markdown } from '../../../components/Markdown'
import { TranscriptItemView } from '../../../components/Transcript'
import { T } from '../../../components/ui'
import type { Chat, TranscriptItem } from '../../../runtime/types'

/** The newest report of one helper among the thread's agent cards, so the screen follows it as it works. */
function helperOf(chat: Chat, agentId: string) {
  for (let index = chat.items.length - 1; index >= 0; index--) {
    const item = chat.items[index]!
    if (item.kind !== 'agents') continue
    const task = item.agents.find((entry) => (entry.agentId ?? entry.id) === agentId)
    if (task) return { ...task, agentId }
  }
  return undefined
}

const RowSeparator = () => <View style={{ height: space.m + 2 }} />

/**
 * One sub-agent on a screen of its own, drawn as a thread is: its task, then its messages, thoughts and tool calls in
 * the thread's own rows, and the thread's message box to talk to it through the main agent. Stop is in the bar.
 */
export default function AgentScreen() {
  const { id, agent } = useLocalSearchParams<{ id: string; agent: string }>()
  const chat = useChat(id)
  const store = useStore()
  const latestStore = useRef(store)
  latestStore.current = store
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboardHeight()
  const say = (text: string, values?: Record<string, string | number>) => translate(store.language, text, values)
  const task = chat && agent ? helperOf(chat, agent) : undefined
  const [composerHeight, setComposerHeight] = useState(96)
  const endInset = useSharedValue(96 + space.s)
  const ios = Platform.OS === 'ios'
  const keyboardSlack = ios ? Math.max(0, insets.bottom - space.s) : -space.s
  // The thread's rows are rebuilt whenever its events change, so its own conversation is read again with them.
  const rows = useMemo<TranscriptItem[]>(
    () =>
      chat?.sessionId && task
        ? transcript(helperConversation(store.eventsOf(chat.computerId, chat.sessionId), task))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes when the thread's rows or this helper change; the events it reads are current as of that run
    [chat?.items, chat?.computerId, chat?.sessionId, task?.agentId, task?.status],
  )
  if (!chat || !task)
    return (
      <Screen>
        <Header title={say('Agent')} subtitle={chat?.title ?? ' '} />
        {chat ? (
          <T tone="muted" style={{ padding: space.l }}>
            {say('This agent is no longer in the thread.')}
          </T>
        ) : null}
      </Screen>
    )
  const online = store.isOnline(chat.computerId)
  const host = store.computers.find((entry) => entry.id === chat.computerId)
  const viewOnly = host?.access === 'viewer'
  const writable = () => canWriteHost(latestStore.current.computers.find((entry) => entry.id === chat.computerId))
  const actions = helperActions(task, online)
  const working = online && helperActive(task)
  const command = task.taskType === 'local_bash'
  const lastText = rows.findLast((row) => row.kind === 'text')
  const report =
    task.error ??
    (task.summary && lastText?.kind === 'text' && lastText.text.trim() === task.summary.trim() ? null : task.summary)
  const facts = [
    task.model,
    task.effort,
    task.isolated ? say('Own copy') : undefined,
    task.toolUses !== undefined ? say('{0} tools', { 0: task.toolUses }) : undefined,
    task.tokens !== undefined ? say('{0} tokens', { 0: task.tokens }) : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
  const stop = () =>
    writable() &&
    chat.sessionId &&
    Alert.alert(command ? say('Stop this command?') : say('Stop this agent?'), say('The main thread keeps going.'), [
      { text: say('Cancel'), style: 'cancel' },
      {
        text: say('Stop'),
        style: 'destructive',
        onPress: () =>
          writable() &&
          void latestStore.current
            .invoke(chat.computerId, 'agent.stopTask', chat.sessionId!, task.agentId)
            .catch((error) => Alert.alert(say('Could not stop'), String(error))),
      },
    ])
  const send = async (text: string) => {
    const words = text.trim()
    if (!writable() || !words || !chat.sessionId) return false
    try {
      await latestStore.current.invoke(chat.computerId, 'agent.messageTask', chat.sessionId, task.agentId, words)
    } catch (error) {
      Alert.alert(say('Could not send'), error instanceof Error ? error.message : String(error))
      return false
    }
  }
  return (
    <Screen>
      <Header
        title={task.name}
        subtitle={`${!online ? `${say('Last known')} · ` : ''}${say(helperStatusLabel(task))}`}
        right={
          actions.canStop && !viewOnly ? (
            <HeaderButton
              icon={Square}
              label={command ? say('Stop command') : say('Stop agent')}
              systemIcon="stop.fill"
              actionId="stop-agent"
              onPress={stop}
            />
          ) : null
        }
      />
      <View style={{ flex: 1 }}>
        <PageKeyboardLegendList
          data={rows}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <TranscriptItemView item={item} chat={chat} />}
          contentInsetEndAdjustment={endInset}
          keyboardOffset={keyboardSlack}
          keyboardLiftBehavior="whenAtEnd"
          contentInsetAdjustmentBehavior="automatic"
          estimatedItemSize={160}
          initialScrollAtEnd
          alignItemsAtEnd
          maintainScrollAtEnd={{ animated: false, on: { dataChange: true, itemLayout: true, layout: true } }}
          maintainScrollAtEndThreshold={0}
          ItemSeparatorComponent={RowSeparator}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: space.l }}
          ListHeaderComponent={
            <View style={{ gap: space.m, paddingBottom: space.m + 2 }}>
              {task.recoveryError ? <T tone="muted">{task.recoveryError}</T> : null}
              {/* What the thread's agent asked of it, where a thread starts with the person's first message. */}
              {task.prompt && !(command && task.prompt.trim() === task.name.trim()) ? (
                <View style={{ backgroundColor: c.fill, borderRadius: radius.m, padding: space.m, gap: space.xs }}>
                  <T size={font.caption} tone="muted" weight="600">
                    {say('Task')}
                  </T>
                  <T copyable={task.prompt} numberOfLines={12}>
                    {task.prompt}
                  </T>
                </View>
              ) : null}
            </View>
          }
          ListFooterComponent={
            <View style={{ gap: space.m, paddingTop: rows.length ? space.m + 2 : 0 }}>
              {!rows.length && !working ? (
                <T tone="muted">
                  {command ? say('This command left no output.') : say('This agent left no transcript.')}
                </T>
              ) : null}
              {working ? <LoadingDots color={c.muted} /> : null}
              {report && !working ? (
                <View style={{ backgroundColor: c.fill, borderRadius: radius.m, padding: space.m, gap: space.xs }}>
                  <T size={font.caption} tone={task.error ? 'bad' : 'muted'} weight="600">
                    {task.error ? say('Error') : say('Report')}
                  </T>
                  <Markdown text={report} />
                </View>
              ) : null}
              {facts ? (
                <T size={font.caption} tone="muted">
                  {facts}
                </T>
              ) : null}
            </View>
          }
        />
        <KeyboardLift keyboard={keyboard}>
          <BottomFade height={composerHeight * 0.75} color={c.window} />
          <ComposerDock
            onLayout={(event) => {
              setComposerHeight(event.nativeEvent.layout.height)
              endInset.set(event.nativeEvent.layout.height + space.s)
            }}
          >
            <View style={{ paddingHorizontal: space.s + 2, gap: space.s }}>
              {viewOnly ? <T tone="muted">{VIEW_ONLY_WRITE_NOTICE[store.language]}</T> : null}
              {chat.sessionId && actions.canMessage ? (
                // The thread's own composer, as the aside's: words only, since they reach the agent through the thread's.
                <Composer
                  computerId={chat.computerId}
                  scope={chat.taskId || undefined}
                  draftKey={`${chat.computerId}:agent:${chat.sessionId}:${task.agentId}`}
                  running={false}
                  textOnly
                  model={{ provider: task.provider ?? chat.provider, model: task.model ?? chat.model, effort: '' }}
                  onModel={() => {}}
                  onSend={(text) => send(text)}
                  placeholder={say('Message {0}', { 0: task.name })}
                />
              ) : (
                <T tone="muted" size={font.caption} style={{ paddingHorizontal: space.s, paddingBottom: space.s }}>
                  {!online
                    ? say('Reconnect to use agent controls.')
                    : command
                      ? say('Background commands do not take messages.')
                      : say('This agent does not support direct messages.')}
                </T>
              )}
            </View>
          </ComposerDock>
        </KeyboardLift>
      </View>
    </Screen>
  )
}
