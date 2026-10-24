import { VIEW_ONLY_COMPUTER_NOTICE } from '../runtime/viewerAccess'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Image, Modal, ScrollView, TextInput, View, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { translate } from '@ramu/shared/i18n'
import { COMPUTER_FRAME_STALE_MS, type ComputerAction } from '@ramu/shared/computerBridge'
import type { ComputerSessionSummary } from '@ramu/shared/api'
import {
  LOCAL_INPUT_LIMIT,
  computerControllerLabel,
  frameOffset,
  needsHandoff,
  showsLocalInputLimit,
} from '@ramu/shared/computerControl'
import type { Chat } from '../runtime/types'
import { useStore } from '../runtime/store'
import { font, space, useTheme } from '../theme'
import { Button, Sheet, T } from './ui'
import { useComputerVideo, webrtc } from './useComputerVideo'

type Frame = { uri: string; width: number; height: number; capturedAt: number; generation: number }

const label = computerControllerLabel
const MODE_LABEL = { tap: 'Tap', scroll: 'Scroll', drag: 'Drag', pan: 'Pan view' } as const
/** A touch that moves less than this many points is a tap, not a gesture. */
const TAP_SLOP = 10

/** The phone watches and steers the owning computer's screen. Nothing runs here; the host keeps every grant. */
function ComputerViewer({
  chat,
  session,
  onClose,
  embedded = false,
}: {
  chat: Chat
  session: ComputerSessionSummary
  onClose(): void
  embedded?: boolean
}) {
  const store = useStore()
  const { c: theme } = useTheme()
  const t = (text: string) => translate(store.language, text)
  const io = useRef(store)
  io.current = store
  const viewOnly = store.computers?.find((host) => host.id === chat.computerId)?.access === 'viewer'
  const target = `${chat.computerId}:${chat.taskId}`
  const scope = useRef(target)
  scope.current = target
  const writable = useCallback(
    () =>
      scope.current === target &&
      io.current.computers?.find((host) => host.id === chat.computerId)?.access !== 'viewer' &&
      io.current.isOnline(chat.computerId),
    [target, chat.computerId],
  )
  const [active, setActive] = useState(AppState.currentState === 'active')
  const [frame, setFrame] = useState<Frame | null>(null)
  const [now, setNow] = useState(Date.now())
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [layout, setLayout] = useState({ width: 1, height: 1 })
  const [asked, setAsked] = useState(false)
  // Touch gestures act on the computer only in the chosen mode; Pan moves the zoomed view without sending anything.
  const [mode, setMode] = useState<'tap' | 'scroll' | 'drag' | 'pan'>('tap')
  const [zoom, setZoom] = useState(1)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  // Landscape gets the whole height; the frame is fitted inside the box so touches map through the letterbox bars.
  const window = useWindowDimensions()
  const maxHeight = Math.max(200, window.height - 160)
  const [current, setCurrent] = useState(session)
  const taskId = chat.taskId!
  const video = useComputerVideo(
    chat.computerId,
    taskId,
    session.target.kind === 'display' && session.runtime.id === 'local',
    active,
  )
  const live = video.status === 'live'
  const human = !viewOnly && current.controller.kind === 'human' && !current.paused
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'))
    return () => subscription.remove()
  }, [])
  // Losing the viewer pauses human control whichever transport it used: backgrounding or closing releases input.
  useEffect(() => {
    if (active) return
    if (writable()) void io.current.invoke(chat.computerId, 'computer.disconnect', taskId).catch(() => {})
  }, [active, chat.computerId, taskId, writable])
  useEffect(
    () => () => {
      if (writable()) void io.current.invoke(chat.computerId, 'computer.disconnect', taskId).catch(() => {})
    },
    [chat.computerId, taskId, writable],
  )
  // Frames stop and the last one is dropped when the app is backgrounded, so no screen lingers in the app switcher.
  useEffect(() => {
    if (!active || live) {
      setFrame(null)
      return
    }
    let mounted = true
    let hash: string | undefined
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        // The host holds the request until the screen changes, so an idle screen sends no image over the network.
        const next = await io.current.invoke(chat.computerId, 'computer.frame', taskId, ...(hash ? [hash] : []))
        hash = next.hash
        const summary = await io.current.invoke(chat.computerId, 'computer.session', taskId)
        if (!mounted) return
        setFrame((previous) =>
          next.unchanged
            ? previous && { ...previous, capturedAt: next.capturedAt, generation: next.generation }
            : {
                uri: `data:${next.mimeType};base64,${next.data}`,
                width: next.width,
                height: next.height,
                capturedAt: next.capturedAt,
                generation: next.generation,
              },
        )
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
      if (writable()) void io.current.invoke(chat.computerId, 'computer.disconnect', taskId).catch(() => {})
    }
  }, [active, live, chat.computerId, taskId, writable])
  // With video there is no frame to carry the control generation, so read the session once a second.
  useEffect(() => {
    if (!live || !active) return
    let mounted = true
    const read = () =>
      void io.current.invoke(chat.computerId, 'computer.session', taskId).then(
        (next) => mounted && next && setCurrent(next),
        () => {},
      )
    read()
    const timer = setInterval(read, 1000)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [live, active, chat.computerId, taskId])
  const stale = !live && !!frame && now - frame.capturedAt > COMPUTER_FRAME_STALE_MS
  const surface = live && video.streamURL && webrtc() ? video : frame
  const act = async (work: () => Promise<unknown>) => {
    if (!writable()) return
    try {
      await work()
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  const send = (action: ComputerAction) => {
    if (live) {
      if (human)
        void act(() =>
          io.current.invoke(chat.computerId, 'computer.input', taskId, current.generation, Date.now(), action),
        )
      return
    }
    if (!frame || stale || !human) return
    void act(() =>
      io.current.invoke(chat.computerId, 'computer.input', taskId, frame.generation, frame.capturedAt, action),
    )
  }
  const status = live
    ? t('Live video')
    : error
      ? error
      : !frame
        ? t('Connecting…')
        : stale
          ? t('Last frame')
          : t('Live')
  const Container = embedded ? View : SafeAreaView
  const content = (
    <Container style={{ flex: 1, backgroundColor: theme.canvas }}>
      {!embedded && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.m }}>
          <T weight="600">
            {current.target.name} ·{' '}
            {viewOnly ? (store.language === 'id' ? 'Hanya melihat' : 'View only') : t(label(current))}
          </T>
          <Button kind="ghost" title={t('Close')} onPress={onClose} />
        </View>
      )}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.m, gap: space.s }}>
        <T tone="muted" accessibilityLiveRegion="polite">
          {status}
        </T>
        {human ? (
          <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap' }} accessibilityRole="radiogroup">
            {(['tap', 'scroll', 'drag', 'pan'] as const).map((choice) => (
              <Button
                key={choice}
                kind={mode === choice ? 'primary' : 'secondary'}
                title={t(MODE_LABEL[choice])}
                accessibilityLabel={`${t(MODE_LABEL[choice])}${mode === choice ? `, ${t('Selected')}` : ''}`}
                onPress={() => setMode(choice)}
              />
            ))}
            <Button
              kind="secondary"
              title={`${zoom}×`}
              accessibilityLabel={t('Zoom')}
              onPress={() => setZoom((value) => (value >= 3 ? 1 : value + 1))}
            />
          </View>
        ) : null}
        {surface ? (
          <ScrollView
            horizontal
            nestedScrollEnabled
            scrollEnabled={mode === 'pan' || !human}
            showsHorizontalScrollIndicator={zoom > 1}
          >
            <ScrollView
              nestedScrollEnabled
              scrollEnabled={mode === 'pan' || !human}
              showsVerticalScrollIndicator={zoom > 1}
            >
              <View
                accessible
                accessibilityRole="button"
                accessibilityLabel={t('Computer screen')}
                accessibilityHint={human ? t('Activate to click the middle of the screen') : undefined}
                accessibilityActions={human && !stale ? [{ name: 'activate' }] : []}
                onAccessibilityAction={() =>
                  send({ kind: 'click', x: Math.floor(surface.width / 2), y: Math.floor(surface.height / 2) })
                }
                onLayout={(event) => setLayout(event.nativeEvent.layout)}
                onTouchStart={(event) => {
                  touchStart.current = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }
                }}
                onTouchEnd={(event) => {
                  const from = touchStart.current
                  touchStart.current = null
                  if (!from || !human || mode === 'pan') return
                  const to = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }
                  const start = frameOffset(from, layout, surface)
                  const end = frameOffset(to, layout, surface)
                  if (!start || !end) return
                  const moved = Math.hypot(to.x - from.x, to.y - from.y) > TAP_SLOP
                  if (mode === 'tap') {
                    if (!moved) send({ kind: 'click', ...end })
                  } else if (!moved) {
                    return
                  } else if (mode === 'scroll') {
                    // Dragging the finger up moves the content up, as on the phone itself.
                    send({ kind: 'scroll', x: start.x, y: start.y, dx: start.x - end.x, dy: start.y - end.y })
                  } else {
                    send({ kind: 'drag', fromX: start.x, fromY: start.y, toX: end.x, toY: end.y })
                  }
                }}
                style={{ width: (window.width - space.m * 2) * zoom }}
              >
                {live && video.streamURL && webrtc() ? (
                  (() => {
                    const { RTCView } = webrtc()!
                    return (
                      <RTCView
                        streamURL={video.streamURL}
                        objectFit="contain"
                        style={{
                          width: '100%',
                          aspectRatio: video.width / video.height,
                          maxHeight: maxHeight * zoom,
                        }}
                      />
                    )
                  })()
                ) : frame ? (
                  <Image
                    source={{ uri: frame.uri }}
                    resizeMode="contain"
                    style={{
                      width: '100%',
                      aspectRatio: frame.width / frame.height,
                      maxHeight: maxHeight * zoom,
                      opacity: stale ? 0.5 : 1,
                    }}
                  />
                ) : null}
              </View>
            </ScrollView>
          </ScrollView>
        ) : null}
        {viewOnly ? (
          <T tone="muted">{VIEW_ONLY_COMPUTER_NOTICE[store.language]}</T>
        ) : (
          <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap' }}>
            {human ? (
              <Button
                title={t('Give control to agent')}
                onPress={() => void act(() => io.current.invoke(chat.computerId, 'computer.giveToAgent', taskId))}
              />
            ) : (
              <Button
                title={t('Take control')}
                onPress={() =>
                  void act(async () => {
                    setAsked(false)
                    try {
                      await io.current.invoke(chat.computerId, 'computer.takeControl', taskId)
                    } catch (reason) {
                      if (!needsHandoff(reason instanceof Error ? reason.message : String(reason))) throw reason
                      await io.current.invoke(chat.computerId, 'computer.requestHandoff', taskId)
                      setAsked(true)
                    }
                  })
                }
              />
            )}
            <Button
              kind="ghost"
              title={t('Stop computer use')}
              onPress={() =>
                void act(async () => {
                  await io.current.invoke(chat.computerId, 'computer.revoke', taskId)
                  onClose()
                })
              }
            />
          </View>
        )}
        {asked ? <T tone="muted">{t('Waiting for the device in control to allow it.')}</T> : null}
        {!viewOnly && current.handoffRequest ? (
          <View style={{ gap: space.s }} accessibilityLiveRegion="polite">
            <T>{t('Another device is asking for control')}</T>
            <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap' }}>
              <Button
                title={t('Allow control')}
                onPress={() => void act(() => io.current.invoke(chat.computerId, 'computer.approveHandoff', taskId))}
              />
              <Button
                kind="ghost"
                title={t('Decline')}
                onPress={() => void act(() => io.current.invoke(chat.computerId, 'computer.declineHandoff', taskId))}
              />
            </View>
          </View>
        ) : null}
        {!viewOnly && showsLocalInputLimit(current) ? <T tone="muted">{t(LOCAL_INPUT_LIMIT)}</T> : null}
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
                if (!writable() || !text) return
                send({ kind: 'type', text })
                setText('')
              }}
              blurOnSubmit={false}
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
              <Button
                title={t('Send text')}
                disabled={!text || stale}
                onPress={() => {
                  if (!writable() || !text) return
                  send({ kind: 'type', text })
                  setText('')
                }}
              />
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
    </Container>
  )
  return embedded ? (
    content
  ) : (
    <Modal
      visible
      animationType="slide"
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={onClose}
    >
      {content}
    </Modal>
  )
}
/** Shows only when the host has computer use on and the owner shared this thread's screen with this device. */
export function ComputerActivity({ chat, open, onClose }: { chat: Chat; open: boolean; onClose(): void }) {
  const store = useStore()
  const t = (key: string) => translate(store.language, key)
  const [session, setSession] = useState<ComputerSessionSummary | null>(null)
  const [runtime, setRuntime] = useState<ReturnType<import('@ramu/shared/api').RamuMethods['computer.status']> | null>(
    null,
  )
  const [apps, setApps] = useState<string[]>([])
  const [runtimes, setRuntimes] = useState<import('@ramu/shared/api').ComputerRuntimeInfo[]>([])
  const [selected, setSelected] = useState('local')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, refresh] = useState(0)
  const io = useRef(store)
  io.current = store
  const online = store.isOnline(chat.computerId)
  const viewOnly = store.computers.find((computer) => computer.id === chat.computerId)?.access === 'viewer'
  useEffect(() => {
    if (!open || !chat.taskId || !online) return
    if (viewOnly) {
      let active = true
      const read = () =>
        io.current.invoke(chat.computerId, 'computer.session', chat.taskId!).then(
          (session) => {
            if (active) setSession(session)
          },
          (reason) => {
            if (active) {
              setSession(null)
              setStatus(reason instanceof Error ? reason.message : String(reason))
            }
          },
        )
      void read()
      const timer = setInterval(() => void read(), 2000)
      return () => {
        active = false
        clearInterval(timer)
      }
    }
    let active = true
    setStatus('')
    void Promise.all([
      io.current.invoke(chat.computerId, 'computer.status'),
      io.current.invoke(chat.computerId, 'computer.session', chat.taskId),
      io.current.invoke(chat.computerId, 'computer.runtimes'),
    ])
      .then(([runtime, session, runtimes]) => {
        if (!active) return
        setRuntime(runtime)
        setSession(session)
        setRuntimes(runtimes)
      })
      .catch((reason) => {
        if (active) setStatus(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      active = false
    }
  }, [open, chat.computerId, chat.taskId, online, viewOnly, revision])
  useEffect(() => {
    if (!open || !online || viewOnly) return
    let active = true
    setApps([])
    void io.current.invoke(chat.computerId, 'computer.apps', selected).then(
      (apps) => {
        if (active) setApps(apps)
      },
      () => {},
    )
    return () => {
      active = false
    }
  }, [open, chat.computerId, online, viewOnly, selected, revision])
  if (!chat.taskId) return null
  const host = store.computers.find((computer) => computer.id === chat.computerId)?.name ?? chat.computerId
  const grant = async (app?: string) => {
    if (busy || io.current.computers.find((host) => host.id === chat.computerId)?.access === 'viewer') return
    setBusy(true)
    setStatus('')
    try {
      if (!runtime?.enabled) await store.invoke(chat.computerId, 'computer.setEnabled', true)
      if (io.current.computers.find((host) => host.id === chat.computerId)?.access === 'viewer') return
      const granted = await store.invoke(chat.computerId, 'computer.grant', chat.taskId!, {
        observe: true,
        input: true,
        runtime: selected,
        ...(app ? { app } : {}),
      })
      setSession(granted)
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet presentation="screen" open={open} onClose={onClose} title={`${t('Computer')} · ${host}`} scroll={!session}>
      {open && session ? (
        <ComputerViewer
          key={`${session.runtime.id}:${session.target.id}`}
          chat={chat}
          session={session}
          embedded
          onClose={() => {
            setSession(null)
            refresh((value) => value + 1)
          }}
        />
      ) : (
        <View style={{ padding: space.l, gap: space.m }}>
          {!viewOnly && (
            <T>
              {t(
                'Choose what this thread can view and control. You can take control or stop computer use at any time.',
              )}
            </T>
          )}
          {viewOnly ? (
            <T tone="muted">{VIEW_ONLY_COMPUTER_NOTICE[store.language]}</T>
          ) : !online ? (
            <T tone="muted">{t('Reconnect to use this computer.')}</T>
          ) : (
            <>
              {runtimes.length > 1 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                  {runtimes.map((entry) => (
                    <Button
                      key={entry.id}
                      title={entry.name}
                      kind={selected === entry.id ? 'secondary' : 'ghost'}
                      disabled={!entry.online || busy}
                      onPress={() => setSelected(entry.id)}
                    />
                  ))}
                </View>
              )}
              <Button
                title={t('Use main display')}
                disabled={busy || !runtime || (selected === 'local' && !runtime.runtime.available)}
                onPress={() => void grant()}
              />
              {apps.length ? <T weight="600">{t('Or limit access to one app')}</T> : null}
              {apps.map((app) => (
                <Button key={app} kind="secondary" title={app} disabled={busy} onPress={() => void grant(app)} />
              ))}
              {runtime && !runtime.runtime.available ? (
                <T tone="muted">
                  {runtime.runtime.detail ??
                    t('Allow Screen Recording and Accessibility on this computer, then check again.')}
                </T>
              ) : null}
            </>
          )}
          {status ? <T tone="bad">{t(status)}</T> : null}
          <Button
            kind="ghost"
            title={t('Check again')}
            disabled={!online || busy}
            onPress={() => refresh((value) => value + 1)}
          />
        </View>
      )}
    </Sheet>
  )
}
