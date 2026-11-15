import { useSay } from '../i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Alert, Pressable, TextInput, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { Bot, CircleCheck, CircleSlash, CircleX } from 'lucide-react-native'
import {
  helperActions,
  helperActive,
  helperCounts,
  helperElapsed,
  helperRole,
  helperStatusLabel,
  REPORT_STATUS,
  sortHelpers,
} from '@ramu/shared/chat/helperPresentation'
import { translate, type TranslationValues } from '@ramu/shared/i18n'
import { customAgentHandle, teammateRecipeName } from '@ramu/shared/customAgents'
import type { AgentTask, AgentWork } from '@ramu/shared/types'
import { font, radius, space, useTheme } from '../theme'
import { providerNames, type Chat, type TranscriptItem } from '../runtime/types'
import { useStore } from '../runtime/store'
import { canWriteHost, VIEW_ONLY_WRITE_NOTICE } from '../runtime/viewerAccess'
import { formatDuration } from '../runtime/turns'
import { ProviderIcon } from './Logos'
import { Markdown } from './Markdown'
import { Button, Card, Divider, Sheet, T, tap } from './ui'
import { ActivityText, Collapse, Disclosure } from './Motion'

type Helper = Extract<TranscriptItem, { kind: 'agents' }>['agents'][number]
/** What a helper is, beside its name: Teammate · Review, Sub-agent · Explore, Advisor, Command (as on the desktop). */
export function RoleTag({ task }: { task: Pick<AgentTask, 'teammate' | 'taskType' | 'agentType'> }) {
  const { c } = useTheme()
  const { language } = useStore()
  const { label, detail } = helperRole(task)
  return (
    <View style={{ backgroundColor: c.fill, borderRadius: radius.s, paddingHorizontal: 6, paddingVertical: 1 }}>
      <T size={font.caption} tone="muted" numberOfLines={1}>
        {translate(language, label)}
        {detail ? ` · ${translate(language, detail)}` : ''}
      </T>
    </View>
  )
}

/** A teammate's changes and usage, e.g. "2 files +40 −5 · 3 turns · $0.12". */
function workLine(work: AgentWork, say: (text: string, values?: TranslationValues) => string): string {
  const counts = { 0: work.files, 1: work.added, 2: work.removed }
  const files = work.files
    ? work.files === 1
      ? say('{0} file +{1} −{2}', counts)
      : say('{0} files +{1} −{2}', counts)
    : say('No changes')
  const turns = work.turns === 1 ? say('{0} turn', { 0: work.turns }) : say('{0} turns', { 0: work.turns })
  return [files, turns, ...(work.costUsd ? [`$${work.costUsd.toFixed(2)}`] : [])].join(' · ')
}
/** Only this visible label ticks; backgrounding or leaving the route stops its timer. */
/** How much of a helper's output the sheet reveals at a time, counted from the end. */
const OUTPUT_PAGE = 6000

function HelperTime({ task, online }: { task: AgentTask; online: boolean }) {
  const [now, setNow] = useState(Date.now())
  const active = online && helperActive(task)
  useFocusEffect(
    useCallback(() => {
      let timer: ReturnType<typeof setInterval> | undefined
      const sync = () => {
        clearInterval(timer)
        if (active && AppState.currentState === 'active') {
          setNow(Date.now())
          timer = setInterval(() => setNow(Date.now()), 1000)
        }
      }
      sync()
      const listener = AppState.addEventListener('change', sync)
      return () => {
        clearInterval(timer)
        listener.remove()
      }
    }, [active]),
  )
  const ms = !online && helperActive(task) ? (task.durationMs ?? null) : helperElapsed(task, now)
  return ms === null ? null : (
    <T size={font.caption} tone="muted">
      {formatDuration(ms)}
    </T>
  )
}
export function HelperDetails({ task, chat, onClose }: { task: Helper | undefined; chat: Chat; onClose: () => void }) {
  const store = useStore()
  const say = useSay()
  const { c } = useTheme()
  const [draft, setDraft] = useState('')
  // The helper's whole output is on hand; the sheet shows its tail and reveals earlier parts a page at a time.
  const [shown, setShown] = useState(OUTPUT_PAGE)
  const [sending, setSending] = useState(false)
  // The name while saving a teammate as a custom agent; null when not saving.
  const [saveName, setSaveName] = useState<string | null>(null)
  const inFlight = useRef(false)
  const latestStore = useRef(store)
  latestStore.current = store
  const id = store.language === 'id'
  useEffect(() => setDraft(''), [task?.agentId])
  if (!task) return null
  const online = store.isOnline(chat.computerId)
  const viewOnly = store.computers?.find((host) => host.id === chat.computerId)?.access === 'viewer'
  const writable = () => canWriteHost(latestStore.current.computers?.find((host) => host.id === chat.computerId))
  const actions = helperActions(task, online)
  const send = async () => {
    if (!writable() || !draft.trim() || !chat.sessionId || !actions.canMessage || inFlight.current) return
    const text = draft.trim()
    inFlight.current = true
    setSending(true)
    try {
      await store.invoke(chat.computerId, 'agent.messageTask', chat.sessionId, task.agentId, text)
      setDraft('')
    } catch (error) {
      Alert.alert(say('Could not send'), error instanceof Error ? error.message : String(error))
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }
  const resume = () =>
    writable() &&
    chat.sessionId &&
    void latestStore.current
      .invoke(chat.computerId, 'agent.continueTeammates', chat.sessionId)
      .catch((error) => Alert.alert(say('Could not continue'), String(error)))
  const saveTeammate = async () => {
    if (!writable() || !chat.sessionId || !saveName?.trim() || inFlight.current) return
    inFlight.current = true
    setSending(true)
    try {
      const saved = await latestStore.current.invoke(
        chat.computerId,
        'customAgents.saveTeammate',
        chat.sessionId,
        task.agentId,
        saveName.trim(),
      )
      setSaveName(null)
      Alert.alert(
        say('Saved as a teammate'),
        say('Start a message with @{0} in any thread to bring it in. Edit it in Settings → Custom agents.', {
          0: customAgentHandle(saved.name),
        }),
      )
    } catch (error) {
      Alert.alert(say('Could not save'), error instanceof Error ? error.message : String(error))
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }
  const stop = () =>
    writable() &&
    chat.sessionId &&
    Alert.alert(
      task.taskType === 'local_bash' ? say('Stop this command?') : say('Stop this agent?'),
      say('The main thread keeps going.'),
      [
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
      ],
    )
  return (
    <Sheet open onClose={onClose} title={task.name}>
      <View style={{ paddingHorizontal: space.l, paddingBottom: space.m, gap: space.m }}>
        <T tone="muted">
          {!online ? `${say('Last known')} · ` : ''}
          {say(helperStatusLabel(task))}
        </T>
        <T size={font.caption} tone="muted">
          {[
            task.provider ? providerNames[task.provider] : undefined,
            task.model,
            task.effort,
            task.isolated ? say('Own copy') : undefined,
            task.background ? say('Background') : undefined,
          ]
            .filter(Boolean)
            .join(' · ')}
        </T>
        <HelperTime task={task} online={online} />
        {task.recoveryError ? <T tone="muted">{task.recoveryError}</T> : null}
        {task.prompt ? (
          <>
            <T weight="600">{say('Task')}</T>
            <T copyable={task.prompt}>{task.prompt}</T>
          </>
        ) : null}
        {task.log ? (
          <>
            <T weight="600">{task.log.length > shown ? say('Output excerpt') : say('Output')}</T>
            <Markdown text={task.log.slice(-shown)} />
            {task.log.length > shown ? (
              <Button
                kind="ghost"
                title={say('Show earlier output')}
                onPress={() => setShown((current) => current + OUTPUT_PAGE)}
              />
            ) : null}
          </>
        ) : null}
        {task.work ? (
          <>
            <T weight="600">{say('Changes')}</T>
            <T tone="muted" size={font.caption}>
              {workLine(task.work, say)}
            </T>
            {task.work.paths.map((path) => (
              <T key={path} size={font.caption} mono numberOfLines={1}>
                {path}
              </T>
            ))}
          </>
        ) : null}
        {task.summary || task.error ? (
          <>
            <T weight="600">{say('Report')}</T>
            <Markdown text={task.error ?? task.summary ?? ''} />
          </>
        ) : null}
        {task.toolUses !== undefined || task.tokens !== undefined ? (
          <T tone="muted" size={font.caption}>
            {[
              task.toolUses !== undefined ? say('{0} tools', { 0: task.toolUses }) : '',
              task.tokens !== undefined ? say('{0} tokens', { 0: task.tokens }) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </T>
        ) : null}
        {chat.sessionId && actions.canMessage ? (
          <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'flex-end' }}>
            <TextInput
              accessibilityLabel={say('Message {0}', { 0: task.name })}
              value={draft}
              onChangeText={setDraft}
              multiline
              editable={!viewOnly && !sending}
              placeholder={say('Message {0}', { 0: task.name })}
              placeholderTextColor={c.placeholder}
              style={{
                flex: 1,
                maxHeight: 120,
                minHeight: 44,
                padding: space.m,
                color: c.text,
                backgroundColor: c.fill,
                borderRadius: radius.m,
              }}
            />
            <Button title={say('Send')} disabled={viewOnly || !draft.trim() || sending} onPress={() => void send()} />
          </View>
        ) : (
          <T tone="muted" size={font.caption}>
            {!online ? say('Reconnect to use agent controls.') : say('This agent does not support direct messages.')}
          </T>
        )}
        {viewOnly ? <T tone="muted">{VIEW_ONLY_WRITE_NOTICE[id ? 'id' : 'en']}</T> : null}
        {chat.sessionId && actions.canContinue && !viewOnly ? (
          <>
            <T tone="muted" size={font.caption}>
              {say('The exchange with the main agent paused after a few rounds without you. Its report is waiting.')}
            </T>
            <Button title={say('Continue')} onPress={resume} />
          </>
        ) : null}
        {chat.sessionId && task.teammate && !viewOnly ? (
          saveName === null ? (
            <Button
              kind="ghost"
              title={say('Save as teammate')}
              onPress={() => setSaveName(teammateRecipeName(task))}
            />
          ) : (
            <View style={{ gap: space.s }}>
              <T size={font.caption} tone="muted">
                {say('Its model, its brief and what it may do are saved, so you can bring it into another thread.')}
              </T>
              <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'center' }}>
                <TextInput
                  accessibilityLabel={say('Name')}
                  value={saveName}
                  onChangeText={setSaveName}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={60}
                  editable={!sending}
                  onSubmitEditing={() => void saveTeammate()}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    paddingHorizontal: space.m,
                    color: c.text,
                    backgroundColor: c.fill,
                    borderRadius: radius.m,
                  }}
                />
                <Button
                  title={say('Save')}
                  disabled={!saveName.trim() || sending}
                  onPress={() => void saveTeammate()}
                />
              </View>
            </View>
          )
        ) : null}
        {/* A teammate stays in the thread until it is let go, even between turns, so it gets that instead of Stop. */}
        {chat.sessionId && task.teammate && !viewOnly && task.status !== 'stopped' && task.status !== 'failed' ? (
          <Button
            kind="danger"
            title={say('Remove from thread')}
            onPress={() =>
              writable() &&
              Alert.alert(
                say('Remove {0} from the thread?', { 0: task.name }),
                say('It stops if it is working, and neither you nor the lead can message it afterwards.'),
                [
                  { text: say('Cancel'), style: 'cancel' },
                  {
                    text: say('Remove from thread'),
                    style: 'destructive',
                    onPress: () => {
                      if (!writable()) return
                      onClose()
                      void latestStore.current
                        .invoke(chat.computerId, 'agent.dismissTeammate', chat.sessionId!, task.agentId)
                        .catch((error) => Alert.alert(say('Could not remove'), String(error)))
                    },
                  },
                ],
              )
            }
          />
        ) : chat.sessionId && actions.canStop && !viewOnly ? (
          <Button
            kind="danger"
            title={task.taskType === 'local_bash' ? say('Stop command') : say('Stop agent')}
            onPress={stop}
          />
        ) : null}
        <Button kind="ghost" title={say('Back to thread')} onPress={onClose} />
      </View>
    </Sheet>
  )
}
export function Helpers({
  item,
  chat,
  onToggle,
}: {
  item: Extract<TranscriptItem, { kind: 'agents' }>
  chat: Chat
  onToggle?: () => void
}) {
  const { c } = useTheme()
  const store = useStore()
  const say = useSay()
  const online = store.isOnline(chat.computerId)
  const [open, setOpen] = useState(() => item.agents.some(helperActive))
  const [shownId, setShownId] = useState<string | null>(null)
  const agents = item.agents.map((task) => ({ ...task, agentId: task.agentId ?? task.id }))
  const counts = helperCounts(agents)
  const names = [
    counts.active ? say('{0} active', { 0: counts.active }) : '',
    counts.completed ? say('{0} completed', { 0: counts.completed }) : '',
    counts.failed ? say('{0} failed', { 0: counts.failed }) : '',
    counts.stopped ? say('{0} stopped', { 0: counts.stopped }) : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          tap()
          onToggle?.()
          setOpen((value) => !value)
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, padding: space.m, minHeight: 44 }}
      >
        <Bot size={16} color={c.soft} />
        <View style={{ flex: 1 }}>
          <T weight="600">
            {item.advisor ? say('Advisor') : say('{0} agents', { 0: counts.total })}
            {item.earlier ? ` · ${say('Earlier activity')}` : ''}
          </T>
          <T size={font.caption} tone="muted">
            {!online ? `${say('Last known')} · ` : ''}
            {names}
          </T>
        </View>
        <Disclosure open={open} color={c.muted} />
      </Pressable>
      <Collapse open={open}>
        {sortHelpers(agents).map((helper) => (
          <View key={helper.agentId}>
            <Divider inset={space.m} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${helper.name}, ${say(helperStatusLabel(helper))}`}
              onPress={() => setShownId(helper.agentId)}
              style={{ padding: space.m, minHeight: 44, gap: space.s }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                {helper.provider ? (
                  <ProviderIcon provider={helper.provider} size={16} />
                ) : (
                  <Bot size={16} color={c.soft} />
                )}
                <T weight="500" numberOfLines={1} style={{ flex: 1 }}>
                  {helper.name}
                </T>
                {online && helperActive(helper) ? (
                  <ActivityText active size={font.caption}>
                    {say(helperStatusLabel(helper))}
                  </ActivityText>
                ) : (
                  <T size={font.caption} tone={helper.status === 'failed' ? 'bad' : 'muted'}>
                    {say(helperStatusLabel(helper))}
                  </T>
                )}
              </View>
              {/* On a phone the role sits under the name, so a long name keeps its words. */}
              <View style={{ flexDirection: 'row', paddingLeft: 24 }}>
                <RoleTag task={helper} />
              </View>
              {helper.summary || helper.lastTool ? (
                <T size={font.caption} tone="muted" numberOfLines={2}>
                  {helper.summary ?? helper.lastTool}
                </T>
              ) : null}
              <HelperTime task={helper} online={online} />
            </Pressable>
          </View>
        ))}
      </Collapse>
      <HelperDetails
        key={`${chat.computerId}:${chat.sessionId}:${shownId}`}
        task={agents.find((helper) => helper.agentId === shownId)}
        chat={chat}
        onClose={() => setShownId(null)}
      />
    </Card>
  )
}

const REPORT_ICON = { finished: CircleCheck, failed: CircleX, stopped: CircleSlash } as const

/** "To Opus 5.5" above what you wrote to a teammate; pressing it opens that teammate. */
export function TeammateTo({ teammateId, name, chat }: { teammateId: string; name: string; chat: Chat }) {
  const { c } = useTheme()
  const { language } = useStore()
  const [open, setOpen] = useState(false)
  let agent: Helper | undefined
  for (const entry of chat.items)
    if (entry.kind === 'agents')
      for (const task of entry.agents) if ((task.agentId ?? task.id) === teammateId) agent = task
  return (
    <>
      <Pressable
        accessibilityRole="button"
        disabled={!agent}
        hitSlop={6}
        onPress={() => {
          tap()
          setOpen(true)
        }}
        style={{ alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 4 }}
      >
        {agent?.provider ? <ProviderIcon provider={agent.provider} size={12} /> : <Bot size={12} color={c.muted} />}
        <T size={font.caption} tone="muted">
          {translate(language, 'To {0}', { 0: name })}
        </T>
      </Pressable>
      {open && agent ? (
        <HelperDetails
          task={{ ...agent, agentId: agent.agentId ?? agent.id }}
          chat={chat}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

/**
 * What a sub-agent or teammate sent back, drawn like its row in the agents card: its model's icon, its name and role,
 * how it ended, then its words. Tapping it opens that agent, as tapping its row does.
 */
export function ReportCard({ item, chat }: { item: Extract<TranscriptItem, { kind: 'report' }>; chat: Chat }) {
  const { c } = useTheme()
  const { language } = useStore()
  const [open, setOpen] = useState(false)
  let agent: Helper | undefined
  for (const entry of chat.items)
    if (entry.kind === 'agents') for (const task of entry.agents) if (task.name === item.name) agent = task
  const Icon = REPORT_ICON[item.verb as keyof typeof REPORT_ICON]
  const tint = item.verb === 'failed' ? c.bad : item.verb === 'finished' ? c.ok : c.muted
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${translate(language, REPORT_STATUS[item.verb] ?? item.verb)}`}
        disabled={!agent}
        onPress={() => {
          tap()
          setOpen(true)
        }}
        style={({ pressed }) => ({ padding: space.m, gap: space.s, backgroundColor: pressed ? c.pressed : undefined })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          {agent?.provider ? <ProviderIcon provider={agent.provider} size={16} /> : <Bot size={16} color={c.soft} />}
          <T weight="600" numberOfLines={1} style={{ flex: 1 }}>
            {item.name}
          </T>
          {Icon ? <Icon size={13} color={tint} /> : null}
          <T size={font.caption} tone={item.verb === 'failed' ? 'bad' : 'muted'}>
            {translate(language, REPORT_STATUS[item.verb] ?? item.verb)}
          </T>
        </View>
        {agent ? (
          <View style={{ flexDirection: 'row', paddingLeft: 24 }}>
            <RoleTag task={agent} />
          </View>
        ) : null}
        <Markdown text={item.body} />
      </Pressable>
      {open && agent ? (
        <HelperDetails
          task={{ ...agent, agentId: agent.agentId ?? agent.id }}
          chat={chat}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </Card>
  )
}
