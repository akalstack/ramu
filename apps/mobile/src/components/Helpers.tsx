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
import { translate } from '@ramu/shared/i18n'
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
const copy = (key: string, id: boolean) =>
  id
    ? ({
        Working: 'Bekerja',
        Completed: 'Selesai',
        Failed: 'Gagal',
        Stopped: 'Dihentikan',
        'Waiting for input': 'Menunggu jawaban',
        'Waiting for provider': 'Menunggu penyedia',
        'Recovered activity': 'Aktivitas dipulihkan',
      }[key] ?? key)
    : key
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
function workLine(work: AgentWork, id: boolean): string {
  const files = work.files
    ? `${work.files} ${id ? 'file' : work.files === 1 ? 'file' : 'files'} +${work.added} −${work.removed}`
    : id
      ? 'Tidak ada perubahan'
      : 'No changes'
  const turns = `${work.turns} ${id ? 'giliran' : work.turns === 1 ? 'turn' : 'turns'}`
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
      Alert.alert(
        id ? 'Tidak dapat mengirim' : 'Could not send',
        error instanceof Error ? error.message : String(error),
      )
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }
  const stop = () =>
    writable() &&
    chat.sessionId &&
    Alert.alert(
      task.taskType === 'local_bash'
        ? id
          ? 'Hentikan perintah ini?'
          : 'Stop this command?'
        : id
          ? 'Hentikan agen ini?'
          : 'Stop this agent?',
      id ? 'Thread utama tetap berjalan.' : 'The main thread keeps going.',
      [
        { text: id ? 'Batal' : 'Cancel', style: 'cancel' },
        {
          text: id ? 'Hentikan' : 'Stop',
          style: 'destructive',
          onPress: () =>
            writable() &&
            void latestStore.current
              .invoke(chat.computerId, 'agent.stopTask', chat.sessionId!, task.agentId)
              .catch((error) => Alert.alert('Could not stop', String(error))),
        },
      ],
    )
  return (
    <Sheet open onClose={onClose} title={task.name}>
      <View style={{ paddingHorizontal: space.l, paddingBottom: space.m, gap: space.m }}>
        <T tone="muted">
          {!online ? `${id ? 'Terakhir diketahui' : 'Last known'} · ` : ''}
          {copy(helperStatusLabel(task), id)}
        </T>
        <T size={font.caption} tone="muted">
          {[
            task.provider ? providerNames[task.provider] : undefined,
            task.model,
            task.effort,
            task.isolated ? (id ? 'Salinan terpisah' : 'Own copy') : undefined,
            task.background ? (id ? 'Latar belakang' : 'Background') : undefined,
          ]
            .filter(Boolean)
            .join(' · ')}
        </T>
        <HelperTime task={task} online={online} />
        {task.recoveryError ? <T tone="muted">{task.recoveryError}</T> : null}
        {task.prompt ? (
          <>
            <T weight="600">{id ? 'Tugas' : 'Task'}</T>
            <T copyable={task.prompt}>{task.prompt}</T>
          </>
        ) : null}
        {task.log ? (
          <>
            <T weight="600">
              {task.log.length > shown ? (id ? 'Cuplikan keluaran' : 'Output excerpt') : id ? 'Keluaran' : 'Output'}
            </T>
            <Markdown text={task.log.slice(-shown)} />
            {task.log.length > shown ? (
              <Button
                kind="ghost"
                title={id ? 'Tampilkan keluaran sebelumnya' : 'Show earlier output'}
                onPress={() => setShown((current) => current + OUTPUT_PAGE)}
              />
            ) : null}
          </>
        ) : null}
        {task.work ? (
          <>
            <T weight="600">{id ? 'Perubahan' : 'Changes'}</T>
            <T tone="muted" size={font.caption}>
              {workLine(task.work, id)}
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
            <T weight="600">{id ? 'Laporan' : 'Report'}</T>
            <Markdown text={task.error ?? task.summary ?? ''} />
          </>
        ) : null}
        {task.toolUses !== undefined || task.tokens !== undefined ? (
          <T tone="muted" size={font.caption}>
            {[
              task.toolUses !== undefined ? `${task.toolUses} tools` : '',
              task.tokens !== undefined ? `${task.tokens} tokens` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </T>
        ) : null}
        {chat.sessionId && actions.canMessage ? (
          <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'flex-end' }}>
            <TextInput
              accessibilityLabel={`${id ? 'Pesan untuk' : 'Message'} ${task.name}`}
              value={draft}
              onChangeText={setDraft}
              multiline
              editable={!viewOnly && !sending}
              placeholder={`${id ? 'Pesan untuk' : 'Message'} ${task.name}`}
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
            <Button
              title={id ? 'Kirim' : 'Send'}
              disabled={viewOnly || !draft.trim() || sending}
              onPress={() => void send()}
            />
          </View>
        ) : (
          <T tone="muted" size={font.caption}>
            {!online
              ? id
                ? 'Hubungkan kembali untuk menggunakan kontrol agen.'
                : 'Reconnect to use agent controls.'
              : id
                ? 'Agen ini tidak mendukung pesan langsung.'
                : 'This agent does not support direct messages.'}
          </T>
        )}
        {viewOnly ? <T tone="muted">{VIEW_ONLY_WRITE_NOTICE[id ? 'id' : 'en']}</T> : null}
        {chat.sessionId && actions.canStop && !viewOnly ? (
          <Button kind="danger" title={id ? 'Hentikan agen' : 'Stop agent'} onPress={stop} />
        ) : null}
        <Button kind="ghost" title={id ? 'Kembali ke thread' : 'Back to thread'} onPress={onClose} />
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
  const online = store.isOnline(chat.computerId)
  const id = store.language === 'id'
  const [open, setOpen] = useState(() => item.agents.some(helperActive))
  const [shownId, setShownId] = useState<string | null>(null)
  const agents = item.agents.map((task) => ({ ...task, agentId: task.agentId ?? task.id }))
  const counts = helperCounts(agents)
  const names = [
    counts.active ? `${counts.active} ${id ? 'aktif' : 'active'}` : '',
    counts.completed ? `${counts.completed} ${id ? 'selesai' : 'completed'}` : '',
    counts.failed ? `${counts.failed} ${id ? 'gagal' : 'failed'}` : '',
    counts.stopped ? `${counts.stopped} ${id ? 'dihentikan' : 'stopped'}` : '',
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
            {item.advisor ? (id ? 'Penasihat' : 'Advisor') : `${counts.total} ${id ? 'agen' : 'agents'}`}
            {item.earlier ? ` · ${id ? 'Aktivitas sebelumnya' : 'Earlier activity'}` : ''}
          </T>
          <T size={font.caption} tone="muted">
            {!online ? `${id ? 'Terakhir diketahui' : 'Last known'} · ` : ''}
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
              accessibilityLabel={`${helper.name}, ${copy(helperStatusLabel(helper), id)}`}
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
                    {copy(helperStatusLabel(helper), id)}
                  </ActivityText>
                ) : (
                  <T size={font.caption} tone={helper.status === 'failed' ? 'bad' : 'muted'}>
                    {copy(helperStatusLabel(helper), id)}
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
