import { VIEW_ONLY_COMPUTER_NOTICE } from '../runtime/viewerAccess'
import { PermissionNeeded, RequestPermission } from './DevicePermissions'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Image, PanResponder, ScrollView, View, type GestureResponderEvent } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import {
  ClipboardPaste,
  Ellipsis,
  Keyboard as KeyboardIcon,
  Minimize2,
  Monitor as MonitorIcon,
  Power,
  Command,
} from 'lucide-react-native'
import { clampPan, pinchZoom, screenPoint, screenRect } from '../runtime/computerGestures'
import { translate } from '@ramu/shared/i18n'
import { COMPUTER_FRAME_STALE_MS, type ComputerAction } from '@ramu/shared/computerBridge'
import type { ComputerSessionSummary } from '@ramu/shared/api'
import {
  LOCAL_INPUT_LIMIT,
  computerControllerLabel,
  computerShortcuts,
  needsHandoff,
  showsLocalInputLimit,
} from '@ramu/shared/computerControl'
import type { Chat } from '../runtime/types'
import { useStore } from '../runtime/store'
import { font, space, useTheme } from '../theme'
import { Button, Sheet, T, tap } from './ui'
import {
  ControlPill,
  ControlStrip,
  RemoteKeyboard,
  type RemoteKeyboardHandle,
  ViewerBanner,
  ViewerHeader,
  ViewerMenu,
  ViewerScreen,
  useViewerMenu,
  type ViewerMenuItem,
} from './ViewerChrome'
import { useComputerVideo, webrtc } from './useComputerVideo'

type Frame = { uri: string; width: number; height: number; capturedAt: number; generation: number }

const label = computerControllerLabel
const ORIGIN = { x: 0, y: 0 }
/** Two taps this close in time and place double-click. */
const DOUBLE_TAP_MS = 350
/** Scrolling sends at most this often while the finger moves, so a drag feels live without flooding the host. */
const SCROLL_EVERY_MS = 90
/** A touch that moves less than this many points is a tap, not a gesture. */
const TAP_SLOP = 10
/** A touch held this long right-clicks. */
const HOLD_MS = 500

/** The phone watches and steers the owning computer's screen. Nothing runs here; the host keeps every grant. */
function ComputerViewer({
  chat,
  session,
  onClose,
  onStopped,
}: {
  chat: Chat
  session: ComputerSessionSummary
  onClose(): void
  /** Computer use was stopped: return to the access choices. */
  onStopped(): void
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
  const [error, setError] = useState('')
  const [asked, setAsked] = useState(false)
  // Pinch zooms and two fingers move the picture on the phone only; nothing is sent to the computer for them.
  const [view, setView] = useState<{ zoom: number; pan: { x: number; y: number } }>({ zoom: 1, pan: ORIGIN })
  const { zoom, pan } = view
  const keyboard = useRef<RemoteKeyboardHandle>(null)
  const [typing, setTyping] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)
  const menu = useViewerMenu()
  const [area, setArea] = useState({ width: 0, height: 0 })
  const [current, setCurrent] = useState(session)
  const taskId = chat.taskId!
  const video = useComputerVideo(
    chat.computerId,
    taskId,
    session.target.kind === 'display' && session.runtime.id === 'local',
    active,
  )
  const live = video.status === 'live'
  const human = !viewOnly && current.controller.kind === 'human' && current.controlledHere !== false && !current.paused
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
  const send = (action: ComputerAction): Promise<void> => {
    if (live) {
      if (!human) return Promise.resolve()
      return act(() =>
        io.current.invoke(chat.computerId, 'computer.input', taskId, current.generation, Date.now(), action),
      )
    }
    if (!frame || !human) return Promise.resolve()
    return act(() =>
      io.current.invoke(chat.computerId, 'computer.input', taskId, frame.generation, frame.capturedAt, action),
    )
  }
  // After a tap, a focused text field on the computer raises the phone keyboard of the matching kind. A computer or
  // app that does not report focus leaves the keyboard as it was; the keyboard button still opens it.
  const followFocus = () =>
    setTimeout(() => {
      if (!writable()) return
      void io.current
        .invoke(chat.computerId, 'computer.focus', taskId)
        .then((focus) => {
          if (focus.editable && writable()) keyboard.current?.open(focus.kind)
        })
        .catch(() => {})
    }, 150)
  // Typed keys wait for the one before: autocorrect sends backspaces then the replacement, which must land in order.
  const typed = useRef<Promise<void>>(Promise.resolve())
  // One surface handles every touch: tap clicks, a double tap double-clicks, a held touch right-clicks, a drag scrolls,
  // hold-then-drag drags, and two fingers pinch or move the zoomed picture. Watching, one finger moves a zoomed picture.
  const latest = useRef({ human, surface, area, view, send, followFocus })
  latest.current = { human, surface, area, view, send, followFocus }
  type Touch = {
    start: { x: number; y: number }
    mode: 'pending' | 'hold' | 'scroll' | 'drag' | 'pan' | 'pinch'
    moved: { dx: number; dy: number }
    sent: { dx: number; dy: number; at: number }
    pinch?: { distance: number; center: { x: number; y: number }; zoom: number; pan: { x: number; y: number } }
    timer?: ReturnType<typeof setTimeout>
  }
  const touch = useRef<Touch | null>(null)
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null)
  const gestures = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        const start = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }
        const next: Touch = { start, mode: 'pending', moved: { dx: 0, dy: 0 }, sent: { dx: 0, dy: 0, at: 0 } }
        next.timer = setTimeout(() => {
          if (touch.current === next && next.mode === 'pending' && latest.current.human) {
            next.mode = 'hold'
            tap()
          }
        }, HOLD_MS)
        touch.current = next
      },
      onPanResponderMove: (event: GestureResponderEvent, gesture) => {
        const current = touch.current
        const { human, surface, area, view } = latest.current
        if (!current || !surface) return
        const fingers = event.nativeEvent.touches
        if (gesture.numberActiveTouches >= 2 && fingers.length >= 2) {
          const [a, b] = fingers as unknown as { pageX: number; pageY: number }[]
          const distance = Math.hypot(a!.pageX - b!.pageX, a!.pageY - b!.pageY)
          const center = { x: (a!.pageX + b!.pageX) / 2, y: (a!.pageY + b!.pageY) / 2 }
          if (current.mode !== 'pinch' || !current.pinch) {
            clearTimeout(current.timer)
            current.mode = 'pinch'
            current.pinch = { distance, center, zoom: view.zoom, pan: view.pan }
            return
          }
          const zoom = pinchZoom(current.pinch.zoom, current.pinch.distance, distance)
          const scale = zoom / current.pinch.zoom
          const pan = clampPan(area, surface, zoom, {
            x: current.pinch.pan.x * scale + center.x - current.pinch.center.x,
            y: current.pinch.pan.y * scale + center.y - current.pinch.center.y,
          })
          setView({ zoom, pan })
          return
        }
        if (current.mode === 'pinch') return
        if (current.mode === 'pending' || current.mode === 'hold') {
          if (Math.hypot(gesture.dx, gesture.dy) <= TAP_SLOP) return
          clearTimeout(current.timer)
          current.mode = current.mode === 'hold' ? 'drag' : human ? 'scroll' : 'pan'
          current.sent = { dx: gesture.dx, dy: gesture.dy, at: 0 }
        }
        if (current.mode === 'pan') {
          setView((previous) => ({
            ...previous,
            pan: clampPan(area, surface, previous.zoom, {
              x: previous.pan.x + gesture.dx - current.sent.dx,
              y: previous.pan.y + gesture.dy - current.sent.dy,
            }),
          }))
          current.sent = { dx: gesture.dx, dy: gesture.dy, at: 0 }
          return
        }
        current.moved = { dx: gesture.dx, dy: gesture.dy }
        if (current.mode === 'scroll' && Date.now() - current.sent.at >= SCROLL_EVERY_MS) flushScroll(current)
      },
      onPanResponderRelease: () => {
        const current = touch.current
        touch.current = null
        if (!current) return
        clearTimeout(current.timer)
        const { human, surface, area, view, send } = latest.current
        if (!human || !surface || current.mode === 'pinch' || current.mode === 'pan') return
        const rect = screenRect(area, surface, view.zoom, view.pan)
        const from = screenPoint(current.start, rect, surface)
        if (!from) return
        if (current.mode === 'scroll') return flushScroll(current)
        if (current.mode === 'drag') {
          const to = screenPoint(
            { x: current.start.x + current.moved.dx, y: current.start.y + current.moved.dy },
            rect,
            surface,
          )
          if (to) void send({ kind: 'drag', fromX: from.x, fromY: from.y, toX: to.x, toY: to.y })
          return
        }
        if (current.mode === 'hold') return send({ kind: 'click', ...from, button: 'right' })
        const now = Date.now()
        const previous = lastTap.current
        const double =
          !!previous &&
          now - previous.at < DOUBLE_TAP_MS &&
          Math.hypot(previous.x - current.start.x, previous.y - current.start.y) < 24
        lastTap.current = double ? null : { at: now, ...current.start }
        void send({ kind: 'click', ...from, ...(double ? { clickCount: 2 } : {}) }).then(() =>
          latest.current.followFocus(),
        )
      },
      onPanResponderTerminate: () => {
        clearTimeout(touch.current?.timer)
        touch.current = null
      },
    }),
  ).current
  /** Sends the finger's movement since the last scroll, in remote pixels; dragging up moves the content up. */
  function flushScroll(current: Touch) {
    const { surface, area, view, send } = latest.current
    if (!surface) return
    const rect = screenRect(area, surface, view.zoom, view.pan)
    const at = screenPoint(current.start, rect, surface)
    const scale = surface.width / Math.max(1, rect.width)
    const dx = Math.round(-(current.moved.dx - current.sent.dx) * scale)
    const dy = Math.round(-(current.moved.dy - current.sent.dy) * scale)
    current.sent = { dx: current.moved.dx, dy: current.moved.dy, at: Date.now() }
    if (at && (dx || dy)) void send({ kind: 'scroll', x: at.x, y: at.y, dx, dy })
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
  const hostName = store.computers.find((computer) => computer.id === chat.computerId)?.name
  const takeControl = () =>
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
  // The computer's own command key: Command on a Mac, Control elsewhere. A remote runtime falls back to its host's.
  const shortcuts = computerShortcuts(current.os ?? store.computers.find((pc) => pc.id === chat.computerId)?.os)
  const menuItems: ViewerMenuItem[] = [
    {
      key: 'keys',
      title: t('Keys and shortcuts'),
      icon: Command,
      disabled: !human,
      onPress: () => setKeysOpen(true),
    },
    {
      key: 'paste',
      title: t('Paste'),
      icon: ClipboardPaste,
      disabled: !human,
      onPress: () =>
        void act(async () => {
          const value = (await Clipboard.getStringAsync()).slice(0, 2000)
          if (!value) throw new Error(t('The clipboard is empty.'))
          void send({ kind: 'type', text: value })
        }),
    },
    ...(zoom > 1
      ? [{ key: 'fit', title: t('Fit screen'), icon: Minimize2, onPress: () => setView({ zoom: 1, pan: ORIGIN }) }]
      : []),
    ...(viewOnly
      ? []
      : [
          {
            key: 'stop',
            title: t('Stop computer use'),
            icon: Power,
            destructive: true,
            onPress: () =>
              void act(async () => {
                await io.current.invoke(chat.computerId, 'computer.revoke', taskId)
                onStopped()
              }),
          },
        ]),
  ]
  const rect = surface ? screenRect(area, surface, zoom, pan) : null
  return (
    <View style={{ flex: 1 }}>
      <ViewerHeader
        title={current.target.name}
        subtitle={`${hostName ? `${hostName} · ` : ''}${status}`}
        closeLabel={t('Close computer')}
        onClose={onClose}
        right={
          <ControlPill
            pillRef={menu.anchor}
            icon={Ellipsis}
            label={t('Computer options')}
            size={44}
            onPress={menu.open}
          />
        }
      />
      <ControlStrip
        text={
          viewOnly
            ? store.language === 'id'
              ? 'Hanya melihat'
              : 'View only'
            : asked
              ? t('Waiting for the device in control to allow it.')
              : t(label(current))
        }
        tone={human ? 'accent' : current.interruption === 'local-input' || current.paused ? 'warn' : 'muted'}
        action={
          viewOnly
            ? undefined
            : human
              ? {
                  title: t('Give back to agent'),
                  onPress: () => void act(() => io.current.invoke(chat.computerId, 'computer.giveToAgent', taskId)),
                }
              : store.mayUse(chat.computerId, 'computer')
                ? { title: t('Take control'), disabled: asked, onPress: takeControl }
                : undefined
        }
      />
      {viewOnly ? (
        <ViewerBanner>
          <T tone="muted" size={font.control}>
            {VIEW_ONLY_COMPUTER_NOTICE[store.language]}
          </T>
        </ViewerBanner>
      ) : null}
      {!viewOnly && !store.mayUse(chat.computerId, 'computer') ? (
        <ViewerBanner>
          <PermissionNeeded computerId={chat.computerId} permission="computer" />
        </ViewerBanner>
      ) : null}
      {error ? (
        <ViewerBanner tone="bad">
          <T size={font.control}>{error}</T>
          <RequestPermission computerId={chat.computerId} message={error} />
        </ViewerBanner>
      ) : null}
      {!viewOnly && current.handoffRequest ? (
        <ViewerBanner tone="warn">
          <T>{t('Another device is asking for control')}</T>
          <View style={{ flexDirection: 'row', gap: space.s, justifyContent: 'flex-end' }}>
            <Button
              kind="ghost"
              title={t('Decline')}
              onPress={() => void act(() => io.current.invoke(chat.computerId, 'computer.declineHandoff', taskId))}
            />
            <Button
              title={t('Allow control')}
              onPress={() => void act(() => io.current.invoke(chat.computerId, 'computer.approveHandoff', taskId))}
            />
          </View>
        </ViewerBanner>
      ) : null}
      {!viewOnly && showsLocalInputLimit(current) ? (
        <ViewerBanner>
          <T tone="muted" size={font.control}>
            {t(LOCAL_INPUT_LIMIT)}
          </T>
        </ViewerBanner>
      ) : null}
      <View
        {...gestures.panHandlers}
        accessible
        accessibilityRole="button"
        accessibilityLabel={t('Computer screen')}
        accessibilityHint={
          human
            ? t('Tap to click, hold to right-click, drag to scroll, hold then drag to move, pinch to zoom')
            : undefined
        }
        accessibilityActions={human && surface ? [{ name: 'activate' }] : []}
        onAccessibilityAction={() =>
          surface && send({ kind: 'click', x: Math.floor(surface.width / 2), y: Math.floor(surface.height / 2) })
        }
        style={{ flex: 1, overflow: 'hidden', backgroundColor: theme.canvas }}
        onLayout={(event) => setArea(event.nativeEvent.layout)}
      >
        {surface && rect && rect.width > 0 ? (
          <View pointerEvents="none" style={{ position: 'absolute', ...rect }}>
            {live && video.streamURL && webrtc() ? (
              (() => {
                const { RTCView } = webrtc()!
                return (
                  <RTCView streamURL={video.streamURL} objectFit="contain" style={{ width: '100%', height: '100%' }} />
                )
              })()
            ) : frame ? (
              <Image
                source={{ uri: frame.uri }}
                resizeMode="contain"
                style={{ width: '100%', height: '100%', opacity: stale ? 0.5 : 1 }}
              />
            ) : null}
          </View>
        ) : (
          <View pointerEvents="none" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.m }}>
            <MonitorIcon size={32} color={theme.muted} strokeWidth={1.5} />
            <T tone="muted">{status}</T>
          </View>
        )}
        {human ? (
          <View style={{ position: 'absolute', right: space.m, bottom: space.m }}>
            <ControlPill
              icon={KeyboardIcon}
              label={typing ? t('Hide keyboard') : t('Show keyboard')}
              selected={typing}
              size={48}
              onPress={() => (typing ? keyboard.current?.close() : keyboard.current?.open())}
            />
          </View>
        ) : null}
      </View>
      {human ? (
        <RemoteKeyboard
          handle={keyboard}
          label={t('Type on the computer')}
          onFocusChange={setTyping}
          onKeys={(keys) => {
            for (const key of keys)
              typed.current = typed.current.then(() =>
                send(key.kind === 'text' ? { kind: 'type', text: key.text } : { kind: 'key', key: key.key }),
              )
          }}
        />
      ) : null}
      <ViewerMenu at={menu.at} onClose={menu.close} items={menuItems} label={t('Close menu')} />
      {/* Keys a phone keyboard lacks, and everyday shortcuts; the sheet stays open for several presses in a row. */}
      <Sheet open={keysOpen && human} onClose={() => setKeysOpen(false)} title={t('Keys and shortcuts')}>
        {(
          [
            ['Keys', shortcuts.keys],
            ['Shortcuts', shortcuts.shortcuts],
          ] as const
        ).map(([heading, entries]) => (
          <View key={heading} style={{ paddingHorizontal: space.l, paddingBottom: space.m, gap: space.s }}>
            <T tone="muted" size={font.caption} weight="600">
              {t(heading)}
            </T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {entries.map((entry) => (
                <Button
                  key={entry.id}
                  kind="secondary"
                  title={t(entry.label)}
                  onPress={() => void (typed.current = typed.current.then(() => send(entry.action)))}
                />
              ))}
            </View>
          </View>
        ))}
      </Sheet>
    </View>
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
    ])
      .then(([runtime, session]) => {
        if (!active) return
        setRuntime(runtime)
        setSession(session)
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
    void io.current.invoke(chat.computerId, 'computer.apps').then(
      (apps) => {
        if (active) setApps(apps)
      },
      () => {},
    )
    return () => {
      active = false
    }
  }, [open, chat.computerId, online, viewOnly, revision])
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
    // One full-screen surface for every state, turning with the phone so a wide screen can use landscape.
    <ViewerScreen open={open} onClose={onClose} landscape>
      {open && session ? (
        <ComputerViewer
          key={`${session.runtime.id}:${session.target.id}`}
          chat={chat}
          session={session}
          onClose={onClose}
          onStopped={() => {
            setSession(null)
            refresh((value) => value + 1)
          }}
        />
      ) : (
        <View style={{ flex: 1 }}>
          <ViewerHeader title={t('Computer')} subtitle={host} closeLabel={t('Close computer')} onClose={onClose} />
          <ScrollView contentContainerStyle={{ padding: space.l, gap: space.m }}>
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
                <Button
                  title={t('Use main display')}
                  disabled={busy || !runtime || !runtime.runtime.available}
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
          </ScrollView>
        </View>
      )}
    </ViewerScreen>
  )
}
