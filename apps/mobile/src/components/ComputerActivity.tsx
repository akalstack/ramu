import { useEffect, useRef, useState } from 'react'
import { AppState, Image, Modal, Pressable, ScrollView, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Monitor } from 'lucide-react-native'
import { translate } from '@ramu/shared/i18n'
import { COMPUTER_FRAME_STALE_MS, type ComputerAction } from '@ramu/shared/computerBridge'
import type { ComputerSessionSummary } from '@ramu/shared/api'
import type { Chat } from '../runtime/types'
import { useStore } from '../runtime/store'
import { font, space, useTheme } from '../theme'
import { Button, Sheet, T } from './ui'

type Frame = { uri: string; width: number; height: number; capturedAt: number; generation: number }

const label = (session: ComputerSessionSummary) =>
  session.paused
    ? 'Control paused'
    : session.controller.kind === 'human'
      ? 'You are in control'
      : session.controller.kind === 'agent'
        ? 'Agent control'
        : 'Ready'

/** The phone watches and steers the owning computer's screen. Nothing runs here; the host keeps every grant. */
function ComputerViewer({ chat, session, onClose }: { chat: Chat; session: ComputerSessionSummary; onClose(): void }) {
  const store = useStore()
  const { c: theme } = useTheme()
  const t = (text: string) => translate(store.language, text)
  const io = useRef(store)
  io.current = store
  const [active, setActive] = useState(AppState.currentState === 'active')
  const [frame, setFrame] = useState<Frame | null>(null)
  const [now, setNow] = useState(Date.now())
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [layout, setLayout] = useState({ width: 1, height: 1 })
  const [current, setCurrent] = useState(session)
  const human = current.controller.kind === 'human' && !current.paused
  const taskId = chat.taskId!
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'))
    return () => subscription.remove()
  }, [])
  // Frames stop and the last one is dropped when the app is backgrounded, so no screen lingers in the app switcher.
  useEffect(() => {
    if (!active) {
      setFrame(null)
      return
    }
    let mounted = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const next = await io.current.invoke(chat.computerId, 'computer.frame', taskId)
        const summary = await io.current.invoke(chat.computerId, 'computer.session', taskId)
        if (!mounted) return
        setFrame({
          uri: `data:${next.mimeType};base64,${next.data}`,
          width: next.width,
          height: next.height,
          capturedAt: next.capturedAt,
          generation: next.generation,
        })
        if (summary) setCurrent(summary)
        setError('')
      } catch (reason) {
        if (mounted) setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        if (mounted) {
          setNow(Date.now())
          timer = setTimeout(() => void poll(), 600)
        }
      }
    }
    void poll()
    return () => {
      mounted = false
      clearTimeout(timer)
      void io.current.invoke(chat.computerId, 'computer.disconnect', taskId).catch(() => {})
    }
  }, [active, chat.computerId, taskId])
  const stale = !!frame && now - frame.capturedAt > COMPUTER_FRAME_STALE_MS
  const act = async (work: () => Promise<unknown>) => {
    try {
      await work()
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  const send = (action: ComputerAction) => {
    if (!frame || stale || !human) return
    void act(() =>
      io.current.invoke(chat.computerId, 'computer.input', taskId, frame.generation, frame.capturedAt, action),
    )
  }
  const status = error ? error : !frame ? t('Connecting…') : stale ? t('Last frame') : t('Live')
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.canvas }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.m }}>
          <T weight="600">
            {current.target.name} · {t(label(current))}
          </T>
          <Button kind="ghost" title={t('Close')} onPress={onClose} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.m, gap: space.s }}>
          <T tone="muted" accessibilityLiveRegion="polite">
            {status}
          </T>
          {frame ? (
            <Pressable
              disabled={!human || stale}
              accessibilityRole="button"
              accessibilityLabel={t('Computer screen')}
              onLayout={(event) => setLayout(event.nativeEvent.layout)}
              onPress={(event) =>
                send({
                  kind: 'click',
                  x: Math.min(
                    frame.width - 1,
                    Math.max(0, Math.round((event.nativeEvent.locationX / layout.width) * frame.width)),
                  ),
                  y: Math.min(
                    frame.height - 1,
                    Math.max(0, Math.round((event.nativeEvent.locationY / layout.height) * frame.height)),
                  ),
                })
              }
            >
              <Image
                source={{ uri: frame.uri }}
                resizeMode="stretch"
                style={{ width: '100%', aspectRatio: frame.width / frame.height, opacity: stale ? 0.5 : 1 }}
              />
            </Pressable>
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap' }}>
            {human ? (
              <Button
                title={t('Give control to agent')}
                onPress={() => void act(() => io.current.invoke(chat.computerId, 'computer.giveToAgent', taskId))}
              />
            ) : (
              <Button
                title={t('Take control')}
                onPress={() => void act(() => io.current.invoke(chat.computerId, 'computer.takeControl', taskId))}
              />
            )}
            <Button
              kind="ghost"
              title={t('Stop computer use')}
              onPress={() => void act(() => io.current.invoke(chat.computerId, 'computer.stop', taskId))}
            />
          </View>
          {human && (
            <View style={{ gap: space.s }}>
              <TextInput
                accessibilityLabel={t('Type on the computer')}
                value={text}
                onChangeText={setText}
                maxLength={2000}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="send"
                onSubmitEditing={() => {
                  if (!text) return
                  send({ kind: 'type', text })
                  setText('')
                }}
                style={{
                  color: theme.text,
                  borderWidth: 1,
                  borderColor: theme.line,
                  borderRadius: 6,
                  padding: space.s,
                  fontSize: font.body,
                }}
              />
              <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap' }}>
                {(['Enter', 'Tab', 'Escape', 'Backspace', 'ArrowUp', 'ArrowDown'] as const).map((key) => (
                  <Button
                    key={key}
                    kind="secondary"
                    title={key}
                    disabled={stale}
                    onPress={() => send({ kind: 'key', key })}
                  />
                ))}
                <Button
                  kind="secondary"
                  title={t('Scroll up')}
                  disabled={stale}
                  onPress={() =>
                    frame &&
                    send({
                      kind: 'scroll',
                      x: Math.floor(frame.width / 2),
                      y: Math.floor(frame.height / 2),
                      dx: 0,
                      dy: -300,
                    })
                  }
                />
                <Button
                  kind="secondary"
                  title={t('Scroll down')}
                  disabled={stale}
                  onPress={() =>
                    frame &&
                    send({
                      kind: 'scroll',
                      x: Math.floor(frame.width / 2),
                      y: Math.floor(frame.height / 2),
                      dx: 0,
                      dy: 300,
                    })
                  }
                />
              </View>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

/** Shows only when the host has computer use on and the owner shared this thread's screen with this device. */
export function ComputerActivity({ chat }: { chat: Chat }) {
  const store = useStore()
  const t = (key: string) => translate(store.language, key)
  const [open, setOpen] = useState(false)
  const [viewing, setViewing] = useState(false)
  const [session, setSession] = useState<ComputerSessionSummary | null>(null)
  const [available, setAvailable] = useState(false)
  const [status, setStatus] = useState('')
  const io = useRef(store)
  io.current = store
  const online = store.isOnline(chat.computerId)
  useEffect(() => {
    if (!chat.taskId || !online) return
    let active = true
    void io.current.invoke(chat.computerId, 'computer.status').then(
      (result) => active && setAvailable(result.enabled && result.runtime.available),
      () => active && setAvailable(false),
    )
    return () => {
      active = false
    }
  }, [chat.computerId, chat.taskId, online])
  useEffect(() => {
    if (!open || !available || !chat.taskId || !online) return
    let active = true
    setStatus('')
    void io.current.invoke(chat.computerId, 'computer.session', chat.taskId).then(
      (result) => active && setSession(result),
      (reason) => {
        if (!active) return
        setSession(null)
        setStatus(reason instanceof Error ? reason.message : String(reason))
      },
    )
    return () => {
      active = false
    }
  }, [open, available, chat.computerId, chat.taskId, online])
  if (!chat.taskId || !available) return null
  const host = store.computers.find((computer) => computer.id === chat.computerId)?.name ?? chat.computerId
  return (
    <>
      <Button kind="ghost" icon={Monitor} title={t('Computer')} onPress={() => setOpen(true)} />
      {viewing && session && <ComputerViewer chat={chat} session={session} onClose={() => setViewing(false)} />}
      <Sheet open={open} onClose={() => setOpen(false)} title={`${t('Computer')} · ${host}`}>
        <View style={{ padding: space.m, gap: space.m }}>
          <T tone="muted">
            {t(
              'Viewing needs the computer’s owner to allow this device for the thread. Grants and permissions stay on that computer.',
            )}
          </T>
          {!online ? <T tone="muted">{t('Offline')}</T> : null}
          {session ? (
            <>
              <T weight="600">
                {session.target.name} · {t(label(session))}
              </T>
              <Button
                title={t('View computer')}
                disabled={!online}
                onPress={() => {
                  setOpen(false)
                  setViewing(true)
                }}
              />
            </>
          ) : (
            <T tone="muted">{status || t('No computer is shared with this device for this thread.')}</T>
          )}
        </View>
      </Sheet>
    </>
  )
}
