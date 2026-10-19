import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Alert, Pressable, TextInput, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { Bot } from 'lucide-react-native'
import {
  helperActions,
  helperActive,
  helperCounts,
  helperElapsed,
  helperStatusLabel,
  sortHelpers,
} from '@ramu/shared/chat/helperPresentation'
import type { AgentTask } from '@ramu/shared/types'
import { font, radius, space, useTheme } from '../theme'
import { providerNames, type Chat, type TranscriptItem } from '../runtime/types'
import { useStore } from '../runtime/store'
import { formatDuration } from '../runtime/turns'
import { ProviderIcon } from './Logos'
import { Markdown } from './Markdown'
import { Button, Card, Divider, Sheet, T, tap } from './ui'
import { Disclosure, animateLayout } from './Motion'

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
/** Only this visible label ticks; backgrounding or leaving the route stops its timer. */
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
  const [sending, setSending] = useState(false)
  const inFlight = useRef(false)
  const id = store.language === 'id'
  useEffect(() => setDraft(''), [task?.agentId])
  if (!task) return null
  const online = store.isOnline(chat.computerId)
  const actions = helperActions(task, online)
  const send = async () => {
    if (!draft.trim() || !chat.sessionId || !actions.canMessage || inFlight.current) return
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
    chat.sessionId &&
    Alert.alert(
      id ? 'Hentikan agen ini?' : 'Stop this agent?',
      id ? 'Thread utama tetap berjalan.' : 'The main thread keeps going.',
      [
        { text: id ? 'Batal' : 'Cancel', style: 'cancel' },
        {
          text: id ? 'Hentikan' : 'Stop',
          style: 'destructive',
          onPress: () =>
            void store
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
            <T weight="600">{id ? 'Cuplikan keluaran' : 'Output excerpt'}</T>
            <Markdown text={task.log.slice(-6000)} />
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
              editable={!sending}
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
            <Button title={id ? 'Kirim' : 'Send'} disabled={!draft.trim() || sending} onPress={() => void send()} />
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
        {chat.sessionId && actions.canStop ? (
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
          animateLayout()
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
      {open
        ? sortHelpers(agents).map((helper) => (
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
                  <T weight="500" style={{ flex: 1 }}>
                    {helper.name}
                  </T>
                  <T size={font.caption} tone={helper.status === 'failed' ? 'bad' : 'muted'}>
                    {copy(helperStatusLabel(helper), id)}
                  </T>
                </View>
                {helper.summary || helper.lastTool ? (
                  <T size={font.caption} tone="muted" numberOfLines={2}>
                    {helper.summary ?? helper.lastTool}
                  </T>
                ) : null}
                <HelperTime task={helper} online={online} />
              </Pressable>
            </View>
          ))
        : null}
      <HelperDetails
        key={`${chat.computerId}:${chat.sessionId}:${shownId}`}
        task={agents.find((helper) => helper.agentId === shownId)}
        chat={chat}
        onClose={() => setShownId(null)}
      />
    </Card>
  )
}
