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
/** What a helper is, beside its name: Sub-agent · Explore, Advisor, Command (as on the desktop). */
export function RoleTag({ task }: { task: Pick<AgentTask, 'taskType' | 'agentType'> }) {
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

/** A helper's changes and usage, e.g. "2 files +40 −5 · 3 turns · $0.12". */
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

/** How long a helper has run, counting on while it works and this screen is in front; null before it started. */
function useHelperTime(task: AgentTask, online: boolean): string | null {
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
  return ms === null ? null : formatDuration(ms)
}

function HelperTime({ task, online }: { task: AgentTask; online: boolean }) {
  const time = useHelperTime(task, online)
  return time === null ? null : (
    <T size={font.caption} tone="muted">
      {time}
    </T>
  )
}

/**
 * One helper as a compact row: its model's icon, its name and how it stands on the first line; its role, what it last
 * did and how long it has run on one muted line under the name. Tapping it opens the agent.
 */
function HelperRow({
  helper,
  online,
  onOpen,
}: {
  helper: AgentTask & { agentId: string }
  online: boolean
  onOpen: () => void
}) {
  const { c } = useTheme()
  const say = useSay()
  const { language } = useStore()
  const time = useHelperTime(helper, online)
  const { label, detail } = helperRole(helper)
  const facts = [
    translate(language, label) + (detail ? ` · ${translate(language, detail)}` : ''),
    helper.summary ?? helper.lastTool,
    time,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${helper.name}, ${say(helperStatusLabel(helper))}, ${facts}`}
      onPress={() => {
        tap()
        onOpen()
      }}
      style={({ pressed }) => ({
        paddingHorizontal: space.m,
        paddingVertical: space.s + 2,
        minHeight: 44,
        gap: 2,
        backgroundColor: pressed ? c.pressed : undefined,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        {helper.provider ? <ProviderIcon provider={helper.provider} size={16} /> : <Bot size={16} color={c.soft} />}
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
      <T size={font.caption} tone="muted" numberOfLines={1} style={{ paddingLeft: 24 }}>
        {facts}
      </T>
    </Pressable>
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
  const inFlight = useRef(false)
  const latestStore = useRef(store)
  latestStore.current = store
  const id = store.language === 'id'
  useEffect(() => setDraft(''), [task?.agentId])
  if (!task) return null
  const command = task.taskType === 'local_bash'
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
            task.host ? say('On {0}', { 0: task.host }) : undefined,
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
        {/* A command's description is already the sheet's title; saying it again under Task only pushes its output down. */}
        {task.prompt && !(command && task.prompt.trim() === task.name.trim()) ? (
          <>
            <T weight="600">{say('Task')}</T>
            <T copyable={task.prompt}>{task.prompt}</T>
          </>
        ) : null}
        {task.log ? (
          <>
            <T weight="600">{task.log.length > shown ? say('Output excerpt') : say('Output')}</T>
            {command ? (
              <T mono size={font.caption} selectable>
                {task.log.slice(-shown)}
              </T>
            ) : (
              <Markdown text={task.log.slice(-shown)} />
            )}
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
        {chat.sessionId && actions.canStop && !viewOnly ? (
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
export function Helpers({ item, chat }: { item: Extract<TranscriptItem, { kind: 'agents' }>; chat: Chat }) {
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
  const details = (
    <HelperDetails
      key={`${chat.computerId}:${chat.sessionId}:${shownId}`}
      task={agents.find((helper) => helper.agentId === shownId)}
      chat={chat}
      onClose={() => setShownId(null)}
    />
  )
  // One sub-agent is its own row: a header naming it again above it said the same thing twice.
  if (agents.length === 1 && !item.advisor && !item.earlier)
    return (
      <Card>
        <HelperRow helper={agents[0]!} online={online} onOpen={() => setShownId(agents[0]!.agentId)} />
        {details}
      </Card>
    )
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          tap()
          setOpen((value) => !value)
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, padding: space.m, minHeight: 44 }}
      >
        <Bot size={16} color={c.soft} />
        <View style={{ flex: 1 }}>
          <T weight="600">
            {/* One sub-agent is named, as its card is on the desktop; a count is only for a group. */}
            {item.advisor
              ? say('Advisor')
              : agents.length === 1
                ? agents[0]!.name
                : say('{0} agents', { 0: counts.total })}
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
            <HelperRow helper={helper} online={online} onOpen={() => setShownId(helper.agentId)} />
          </View>
        ))}
      </Collapse>
      {details}
    </Card>
  )
}

const REPORT_ICON = { finished: CircleCheck, failed: CircleX, stopped: CircleSlash } as const

/**
 * What a sub-agent sent back, drawn like its row in the agents card: its model's icon, its name and role,
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
