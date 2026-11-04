import { useHostWriteAccess } from '../composer/useHostWriteAccess'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Ellipsis, Keyboard, Monitor, PictureInPicture2 } from 'lucide-react'
import { floatLiveView } from '../liveView/liveViewStore'
import { OPEN_COMPUTER_EVENT } from './openComputer'
import { useAppSettings } from '../settings/AppSettings'
import type { ComputerSessionSummary } from '@ramu/shared/api'
import { COMPUTER_FRAME_STALE_MS, MAX_COMPUTER_TEXT, type ComputerAction } from '@ramu/shared/computerBridge'
import {
  LOCAL_INPUT_LIMIT,
  computerKeyAction,
  computerShortcuts,
  frameOffset,
  needsHandoff,
  showsLocalInputLimit,
  type ComputerOs,
} from '@ramu/shared/computerControl'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { useHost } from '../workspace/HostProvider'
import { Button } from '@/components/desktop-button'
import { Dropdown, Menu } from '../Menu'
import { cn } from 'cn'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { controllerLabel } from './computerLabels'
import { useComputerVideo } from './useComputerVideo'
import { ComputerSharing } from './ComputerSharing'
import { ComposerTraySection } from '../composer/ComposerTraySection'
import { PermissionNeeded } from '../settings/DevicePermissions'
import { refusedPermission, type DevicePermission } from '@ramu/shared/devicePermissions'

const VIEW_ONLY_COMPUTER_NOTICE =
  'This device can watch screens the host owner has shared with this thread. Control requires full access.'

type Invoke = ReturnType<typeof useHost>['invoke']

/** Takes control; when another device holds it, asks that device instead of taking it. Returns whether it asked. */
async function takeOrRequest(invoke: Invoke, taskId: string): Promise<'asked' | 'taken'> {
  try {
    await invoke('computer.takeControl', taskId)
    return 'taken'
  } catch (reason) {
    if (!needsHandoff(reason instanceof Error ? reason.message : String(reason))) throw reason
    await invoke('computer.requestHandoff', taskId)
    return 'asked'
  }
}

/** Shown to the devices that can answer: another device wants control and only the one in control can allow it. */
function HandoffNotice({
  taskId,
  session,
  run,
}: {
  taskId: string
  session: ComputerSessionSummary
  run: (work: () => Promise<unknown>) => Promise<void>
}) {
  const { invoke } = useHost()
  if (!session.handoffRequest) return null
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 text-caption">
      <span>{t('Another device is asking for control')}</span>
      <Button size="sm" onClick={() => void run(() => invoke('computer.approveHandoff', taskId))}>
        {t('Allow control')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => void run(() => invoke('computer.declineHandoff', taskId))}>
        {t('Decline')}
      </Button>
    </div>
  )
}

type Frame = { data: string; mimeType: string; width: number; height: number; capturedAt: number; generation: number }

/** The viewer's own system, so Command and Control shortcuts translate for the computer being controlled. */
const VIEWER_OS: ComputerOs = /Mac|iPhone|iPad/.test(navigator.platform)
  ? 'macos'
  : /Win/.test(navigator.platform)
    ? 'windows'
    : 'linux'
/** A press that moves farther than this many pixels before release drags instead of clicking. */
const DRAG_SLOP = 6
/** Wheel scrolling is sent at most this often, with the movement in between added up. */
const SCROLL_EVERY_MS = 80

/**
 * The computer's screen, sized to the window. While you control it, click the screen to use your own mouse and keyboard
 * on it, as in a remote desktop: clicks, double-clicks, right-clicks, drags, the scroll wheel, typing and shortcuts.
 * Polling stops with the dialog, so an observation-only viewer costs nothing when it is closed.
 */
function Viewer({
  taskId,
  session,
  onClose,
  run,
  onAsked,
}: {
  taskId: string
  session: ComputerSessionSummary
  onClose(): void
  run: (work: () => Promise<unknown>) => Promise<void>
  onAsked(): void
}) {
  const { invoke } = useHost()
  const { viewOnly, canWrite } = useHostWriteAccess()
  const [frame, setFrame] = useState<Frame | null>(null)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  const [capturing, setCapturing] = useState(false)
  const capturingNow = useRef(capturing)
  capturingNow.current = capturing
  const video = useComputerVideo(taskId, session.target.kind === 'display' && session.runtime.id === 'local')
  const live = video.status === 'live'
  const [liveSession, setLiveSession] = useState(session)
  const current = live ? liveSession : session
  // Control on another of the person's devices shows that device has it; Take control moves it here.
  const human = !viewOnly && current.controller.kind === 'human' && current.controlledHere !== false
  // With video there is no image to carry the control generation, so read it from the session once a second.
  useEffect(() => {
    if (!live) return
    let active = true
    const read = () =>
      void invoke('computer.session', taskId).then(
        (next) => active && next && setLiveSession(next),
        () => {},
      )
    read()
    const timer = setInterval(read, 1000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [invoke, taskId, live, canWrite])
  // Closing the viewer ends human control's input even when the picture came as video.
  useEffect(
    () => () => {
      if (canWrite()) void invoke('computer.disconnect', taskId).catch(() => {})
    },
    [invoke, taskId, canWrite],
  )
  useEffect(() => {
    if (live) return
    let active = true
    let hash: string | undefined
    const tick = async () => {
      try {
        // The host holds the request until the screen changes (or briefly times out), so an idle screen sends no image.
        const next = await invoke('computer.frame', taskId, ...(hash ? [hash] : []))
        hash = next.hash
        if (active) {
          setFrame((previous) =>
            next.unchanged
              ? previous && { ...previous, capturedAt: next.capturedAt, generation: next.generation }
              : next,
          )
          setError('')
        }
      } catch (reason) {
        if (active) setError(t(errorText(reason)))
      }
    }
    void tick()
    const timer = setInterval(() => {
      setNow(Date.now())
      void tick()
    }, 500)
    return () => {
      active = false
      clearInterval(timer)
      // A human controller that closes the viewer pauses input rather than leaving it open unseen.
      canWrite() && void invoke('computer.disconnect', taskId).catch(() => {})
    }
  }, [invoke, taskId, live, canWrite])
  const stale = !live && !!frame && now - frame.capturedAt > COMPUTER_FRAME_STALE_MS
  const surface = live && video.width ? { width: video.width, height: video.height } : frame
  // Input goes out one action at a time, so a typed word or a shortcut never arrives out of order.
  const queue = useRef<Promise<void>>(Promise.resolve())
  // Text typed while earlier input is still on its way joins one action, so a password does not cost a round trip per
  // character. Anything else closes the run, which keeps keys in the order they were pressed.
  const typing = useRef<{ text: string } | null>(null)
  const send = (action: ComputerAction) => {
    if (!canWrite() || !human) return
    if (!live && (!frame || stale)) return
    const generation = live ? liveSession.generation : frame!.generation
    const capturedAt = live ? Date.now() : frame!.capturedAt
    if (
      action.kind === 'type' &&
      typing.current &&
      typing.current.text.length + action.text.length <= MAX_COMPUTER_TEXT
    ) {
      typing.current.text += action.text
      return
    }
    const deliver = (next: ComputerAction) => run(() => invoke('computer.input', taskId, generation, capturedAt, next))
    if (action.kind === 'type') {
      const pending = { text: action.text }
      typing.current = pending
      queue.current = queue.current.then(() => {
        if (typing.current === pending) typing.current = null
        return deliver({ kind: 'type', text: pending.text })
      })
      return
    }
    typing.current = null
    queue.current = queue.current.then(() => deliver(action))
  }
  const videoElement = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (videoElement.current) videoElement.current.srcObject = live ? video.stream : null
  }, [live, video.stream])
  const screen = useRef<HTMLDivElement>(null)
  /** The computer pixel under the pointer; the picture is letterboxed inside the screen area. */
  const point = (event: { clientX: number; clientY: number }) => {
    const box = screen.current?.getBoundingClientRect()
    if (!box || !surface) return null
    return frameOffset({ x: event.clientX - box.left, y: event.clientY - box.top }, box, surface)
  }
  const press = useRef<{ x: number; y: number; clientX: number; clientY: number; button: number } | null>(null)
  const wheel = useRef({ dx: 0, dy: 0, at: { x: 0, y: 0 }, timer: 0 as ReturnType<typeof setTimeout> | 0 })
  const flushWheel = () => {
    const pending = wheel.current
    pending.timer = 0
    if (!surface || !screen.current) return
    const box = screen.current.getBoundingClientRect()
    const scale = surface.width / Math.max(1, Math.min(box.width, (box.height * surface.width) / surface.height))
    const dx = Math.round(pending.dx * scale)
    const dy = Math.round(pending.dy * scale)
    pending.dx = 0
    pending.dy = 0
    if (dx || dy) send({ kind: 'scroll', ...pending.at, dx, dy })
  }
  const status = live
    ? t('Live video')
    : error
      ? error
      : !frame
        ? t('Connecting…')
        : stale
          ? t('Last frame · {0}', { 0: new Date(frame.capturedAt).toLocaleTimeString() })
          : t('Live')
  const shortcuts = computerShortcuts(current.os)
  const takeControl = () =>
    void run(async () => {
      if ((await takeOrRequest(invoke, taskId)) === 'asked') onAsked()
      else screen.current?.focus()
    })
  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        // Escape belongs to the computer while you are using it; click outside the screen to get it back.
        if (!open && capturingNow.current && (details as { reason?: string } | undefined)?.reason === 'escape-key')
          return
        if (!open) onClose()
      }}
    >
      <DialogContent className="flex h-[min(92vh,980px)] w-[min(96vw,1500px)] sm:max-w-none flex-col gap-3 sm:max-w-none">
        <DialogHeader className="pr-8">
          <DialogTitle>{session.target.name}</DialogTitle>
          <DialogDescription>
            {session.runtime.name} · {status}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" className={human ? 'text-control text-foreground' : 'text-control text-muted-foreground'}>
            {viewOnly ? t('View only') : t(controllerLabel(current))}
          </span>
          <div className="flex-1" />
          {human && (
            <Menu
              standard
              label={t('Keys')}
              icon={<Keyboard />}
              align="end"
              items={[
                { key: 'keys-heading', heading: t('Keys') },
                ...shortcuts.keys.map((entry) => ({
                  key: entry.id,
                  label: t(entry.label),
                  onSelect: () => send(entry.action),
                })),
                { key: 'shortcuts-heading', heading: t('Shortcuts') },
                ...shortcuts.shortcuts.map((entry) => ({
                  key: entry.id,
                  label: t(entry.label),
                  onSelect: () => send(entry.action),
                })),
              ]}
            />
          )}
          {!viewOnly &&
            (human ? (
              <Button size="sm" onClick={() => void run(() => invoke('computer.giveToAgent', taskId))}>
                {t('Give back to agent')}
              </Button>
            ) : (
              <Button size="sm" onClick={takeControl}>
                {t('Take control')}
              </Button>
            ))}
        </div>
        {!viewOnly && <HandoffNotice taskId={taskId} session={current} run={run} />}
        <div
          ref={screen}
          tabIndex={human ? 0 : -1}
          role="application"
          aria-label={t('Computer screen')}
          aria-description={
            human ? t('Click to use your mouse and keyboard on this computer. Click outside to stop.') : undefined
          }
          className={cn(
            'relative min-h-0 flex-1 overflow-hidden rounded-lg bg-black/80 outline-none select-none',
            human && 'cursor-default',
            capturing && 'ring-2 ring-primary',
          )}
          onFocus={() => setCapturing(human)}
          onBlur={() => setCapturing(false)}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            if (!human) return
            screen.current?.focus()
            const at = point(event)
            if (!at) return
            event.preventDefault()
            press.current = { ...at, clientX: event.clientX, clientY: event.clientY, button: event.button }
          }}
          onPointerUp={(event) => {
            const start = press.current
            press.current = null
            if (!human || !start) return
            const end = point(event)
            const moved = Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > DRAG_SLOP
            if (moved && start.button === 0 && end) {
              send({ kind: 'drag', fromX: start.x, fromY: start.y, toX: end.x, toY: end.y })
              return
            }
            const button = start.button === 2 ? 'right' : start.button === 1 ? 'middle' : 'left'
            // The second press of a double-click completes it; the first was already sent as a click.
            const clickCount = button === 'left' && event.detail >= 2 ? 2 : 1
            send({
              kind: 'click',
              x: start.x,
              y: start.y,
              ...(button === 'left' ? {} : { button }),
              ...(clickCount > 1 ? { clickCount } : {}),
            })
          }}
          onWheel={(event) => {
            if (!human) return
            const at = point(event)
            if (!at) return
            const pending = wheel.current
            pending.dx += event.deltaX
            pending.dy += event.deltaY
            pending.at = at
            if (!pending.timer) pending.timer = setTimeout(flushWheel, SCROLL_EVERY_MS)
          }}
          onKeyDown={(event) => {
            if (!human || !capturing) return
            // Paste types this computer's clipboard there instead of pasting the other computer's.
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') return
            const action = computerKeyAction(event, { viewer: VIEWER_OS, target: current.os })
            if (!action) return
            event.preventDefault()
            event.stopPropagation()
            send(action)
          }}
          onPaste={(event) => {
            if (!human || !capturing) return
            const text = event.clipboardData.getData('text/plain').slice(0, 2000)
            event.preventDefault()
            if (text) send({ kind: 'type', text })
          }}
        >
          {live ? (
            <video
              ref={videoElement}
              autoPlay
              muted
              playsInline
              aria-hidden
              className="pointer-events-none h-full w-full object-contain"
            />
          ) : frame ? (
            <img
              alt=""
              draggable={false}
              className={cn('pointer-events-none h-full w-full object-contain', stale && 'opacity-50')}
              src={`data:${frame.mimeType};base64,${frame.data}`}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-control text-muted-foreground">{status}</div>
          )}
          {human && !capturing && (frame || live) && (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
              <span className="rounded-full bg-popover/90 px-3 py-1 text-caption text-popover-foreground ring-1 ring-border">
                {t('Click the screen to use your mouse and keyboard')}
              </span>
            </div>
          )}
        </div>
        {viewOnly && (
          <p role="status" className="text-caption text-muted-foreground">
            {t(VIEW_ONLY_COMPUTER_NOTICE)}
          </p>
        )}
        {!viewOnly && showsLocalInputLimit(current) && (
          <span className="text-caption text-muted-foreground">{t(LOCAL_INPUT_LIMIT)}</span>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** A small, slowly refreshing picture of the shared screen; it stops while the full viewer is open. */
function ScreenThumbnail({
  taskId,
  label,
  live,
  onOpen,
}: {
  taskId: string
  label: string
  live: boolean
  onOpen(): void
}) {
  const { invoke } = useHost()
  const [image, setImage] = useState<string | null>(null)
  useEffect(() => {
    if (!live) return
    let active = true
    let hash: string | undefined
    let timer: ReturnType<typeof setTimeout>
    const read = async () => {
      try {
        const next = await invoke('computer.frame', taskId, ...(hash ? [hash] : []))
        hash = next.hash
        if (active && !next.unchanged) setImage(`data:${next.mimeType};base64,${next.data}`)
      } catch {
        // A glance only: the viewer explains errors when opened.
      } finally {
        if (active) timer = setTimeout(() => void read(), 2500)
      }
    }
    void read()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [invoke, taskId, live])
  return (
    <Button
      variant="ghost"
      aria-label={label}
      onClick={onOpen}
      className="h-16 w-28 flex-none overflow-hidden rounded-md bg-muted p-0 ring-1 ring-border transition hover:ring-primary"
    >
      {image ? (
        <img alt="" src={image} className="h-full w-full object-cover" />
      ) : (
        <Monitor className="size-5 text-muted-foreground" />
      )}
    </Button>
  )
}

export type ComputerActivityState = {
  taskId: string | undefined
  session: ComputerSessionSummary | null
  keepAwake: boolean
  reload: () => Promise<void>
}

/** The thread's computer session, polled while the chat is visible; the tray shows Computer only while one exists. */
export function useComputerActivity(taskId: string | undefined, visible: boolean): ComputerActivityState {
  const { invoke, id: hostId } = useHost()
  const { viewOnly } = useHostWriteAccess()
  const scope = `${hostId}:${taskId}`
  const current = useRef(scope)
  current.current = scope
  const requests = useRef(0)
  const [reading, setReading] = useState<{ scope: string; session: ComputerSessionSummary | null; keepAwake: boolean }>(
    { scope, session: null, keepAwake: true },
  )
  const load = useCallback(async () => {
    if (!taskId || current.current !== scope) return
    const request = ++requests.current
    const valid = () => current.current === scope && requests.current === request
    // A test device is a computer session too, and it works without turning computer use on.
    const session = await invoke('computer.session', taskId).catch(() => null)
    if (!valid()) return
    const status = session && !viewOnly ? await invoke('computer.status').catch(() => null) : null
    if (valid()) setReading({ scope, session, keepAwake: status?.keepAwake ?? true })
  }, [invoke, taskId, viewOnly, scope])
  useEffect(() => {
    if (!taskId || !visible) return
    void load()
    const timer = setInterval(() => void load(), 2000)
    return () => clearInterval(timer)
  }, [load, taskId, visible])
  const mine = reading.scope === scope
  return {
    taskId,
    session: mine && taskId ? reading.session : null,
    keepAwake: mine ? reading.keepAwake : true,
    reload: load,
  }
}

function useComputerRun(reload: () => Promise<void>) {
  const { canWrite } = useHostWriteAccess()
  const [error, setError] = useState('')
  const [needed, setNeeded] = useState<DevicePermission | null>(null)
  const run = async (work: () => Promise<unknown>) => {
    if (!canWrite()) return false
    setError('')
    setNeeded(null)
    let done = true
    try {
      await work()
    } catch (reason) {
      done = false
      setError(t(errorText(reason)))
      setNeeded(refusedPermission(errorText(reason)))
    }
    await reload()
    return done
  }
  return { run, error, needed }
}

function ComputerProblem({ needed, error }: { needed: DevicePermission | null; error: string }) {
  const { id: hostId } = useHost()
  if (needed) return <PermissionNeeded host={hostId} permission={needed} />
  if (!error) return null
  return (
    <span role="alert" className="text-caption text-destructive">
      {error}
    </span>
  )
}

/** The tray row for a thread that is using a computer: view it, trade control and end access. */
export function ComputerActivity({ state }: { state: ComputerActivityState }) {
  useLanguage()
  const { taskId, session, keepAwake, reload } = state
  const liveView = useAppSettings().preferences.liveViewDesktop
  const { invoke, id: hostId } = useHost()
  const { viewOnly } = useHostWriteAccess()
  const [viewing, setViewing] = useState(false)
  const [asked, setAsked] = useState(false)
  const { run: runWork, error, needed } = useComputerRun(reload)
  const run = async (work: () => Promise<unknown>) => {
    setAsked(false)
    await runWork(work)
  }
  // The header button and shortcut ask for this thread's computer; with a session they open its viewer.
  useEffect(() => {
    const open = (event: Event) => {
      if ((event as CustomEvent<{ taskId: string }>).detail.taskId === taskId) setViewing(true)
    }
    window.addEventListener(OPEN_COMPUTER_EVENT, open)
    return () => window.removeEventListener(OPEN_COMPUTER_EVENT, open)
  }, [taskId])
  if (!taskId || !session) return null
  return (
    <ComposerTraySection
      aria-label={t('Computer')}
      title={t('Computer')}
      icon={<Monitor />}
      actions={
        liveView ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="icon small-icon"
            aria-label={t('Float')}
            title={t('Float: keep a live view in the corner')}
            onClick={() => floatLiveView(hostId, taskId, { kind: 'computer' })}
          >
            <PictureInPicture2 size={14} />
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-2 text-control">
        {viewOnly && (
          <p role="status" className="text-caption text-muted-foreground">
            {t(VIEW_ONLY_COMPUTER_NOTICE)}
          </p>
        )}
        <div className="flex items-center gap-3">
          <ScreenThumbnail
            taskId={taskId}
            label={t('Open {0}', { 0: session.target.name })}
            live={!viewing}
            onOpen={() => setViewing(true)}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="truncate text-control">{session.target.name}</span>
            <span className="text-caption text-muted-foreground">
              {viewOnly ? t('View only') : t(controllerLabel(session))}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setViewing(true)}>
                {t('View computer')}
              </Button>
              {!viewOnly &&
                (session.controller.kind === 'human' ? (
                  <Button size="sm" onClick={() => void run(() => invoke('computer.giveToAgent', taskId))}>
                    {t('Give back to agent')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      void run(async () => {
                        if ((await takeOrRequest(invoke, taskId)) === 'asked') setAsked(true)
                        else setViewing(true)
                      })
                    }
                  >
                    {t('Take control')}
                  </Button>
                ))}
              {!viewOnly && (
                <Menu
                  label={t('Computer options')}
                  icon={<Ellipsis />}
                  align="end"
                  items={[
                    {
                      key: 'stop-agent',
                      label: t('Stop the agent'),
                      title: t('Stops the agent’s work in this thread; access to the computer stays.'),
                      onSelect: () => void run(() => invoke('computer.stop', taskId)),
                    },
                    {
                      key: 'revoke',
                      label: t('Stop computer use'),
                      title: t('Ends this thread’s access to the computer.'),
                      danger: true,
                      onSelect: () => void run(() => invoke('computer.revoke', taskId)),
                    },
                  ]}
                />
              )}
            </div>
          </div>
        </div>
        {!viewOnly && <HandoffNotice taskId={taskId} session={session} run={run} />}
        {asked && (
          <span className="text-caption text-muted-foreground">
            {t('Waiting for the device in control to allow it.')}
          </span>
        )}
        {!viewOnly && showsLocalInputLimit(session) && (
          <span className="text-caption text-muted-foreground">{t(LOCAL_INPUT_LIMIT)}</span>
        )}
        {!keepAwake && (
          <span className="text-caption text-muted-foreground">
            {t('This Mac may sleep when idle and stop the agent. Turn on Keep awake in Settings → System.')}
          </span>
        )}
        {!viewOnly && <ComputerSharing />}
        <ComputerProblem needed={needed} error={error} />
      </div>
      {viewing && (
        <Viewer
          taskId={taskId}
          session={session}
          run={run}
          onAsked={() => setAsked(true)}
          onClose={() => setViewing(false)}
        />
      )}
    </ComposerTraySection>
  )
}

/**
 * Granting this thread the computer by hand, opened from the header button or shortcut while nothing is shared.
 * Agents usually ask for it themselves through a permission request.
 */
export function ComputerGrantDialog({ state }: { state: ComputerActivityState }) {
  useLanguage()
  const { taskId, session, reload } = state
  const { invoke } = useHost()
  const { viewOnly, canWrite } = useHostWriteAccess()
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [ready, setReady] = useState(false)
  const [locked, setLocked] = useState(false)
  const [apps, setApps] = useState<string[]>([])
  const [appHint, setAppHint] = useState('')
  const [app, setApp] = useState('')
  const { run, error, needed } = useComputerRun(reload)
  useEffect(() => {
    const show = (event: Event) => {
      if ((event as CustomEvent<{ taskId: string }>).detail.taskId !== taskId || session || viewOnly) return
      setLoaded(false)
      setOpen(true)
    }
    window.addEventListener(OPEN_COMPUTER_EVENT, show)
    return () => window.removeEventListener(OPEN_COMPUTER_EVENT, show)
  }, [taskId, session, viewOnly])
  useEffect(() => {
    if (!open || !taskId) return
    let active = true
    void (async () => {
      const status = await invoke('computer.status').catch(() => null)
      if (!active || !canWrite()) return
      const appsReady = !!status?.apps?.available
      const apps = status?.enabled && appsReady ? await invoke('computer.apps').catch(() => []) : []
      if (!active) return
      setReady(!!status?.enabled && (status.runtime.available || appsReady))
      setLocked(!!status && !status.runtime.available && status.runtime.reason === 'locked')
      setAppHint(status?.apps && !status.apps.available ? (status.apps.detail ?? '') : '')
      setApps(apps)
      setLoaded(true)
    })()
    return () => {
      active = false
    }
  }, [open, taskId, invoke, canWrite])
  if (!taskId) return null
  const grant = (options: { app?: string }) =>
    void run(() => invoke('computer.grant', taskId, { observe: true, input: true, ...options })).then(
      (done) => done && setOpen(false),
    )
  return (
    // A grant from anywhere, including the agent's own request, makes this dialog moot.
    <Dialog open={open && !session} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Computer')}</DialogTitle>
          <DialogDescription>
            {t(
              'Allow this thread to see and control your main display. Revoke it any time. Ramu cannot tell when you use your own mouse or keyboard, so choose Take control before you do.',
            )}
          </DialogDescription>
        </DialogHeader>
        {loaded && (
          <div className="flex flex-col gap-2 text-control">
            {ready ? (
              <div className="flex flex-wrap items-center gap-2">
                {apps.length > 0 && (
                  <>
                    <Dropdown
                      label={t('App')}
                      value={app}
                      options={[
                        { value: '', label: t('Choose an app') },
                        ...apps.map((name) => ({ value: name, label: name })),
                      ]}
                      onChange={setApp}
                    />
                    <Button size="sm" disabled={!app} onClick={() => grant({ app })}>
                      {t('Allow this app')}
                    </Button>
                  </>
                )}
                {!locked && (
                  <Button size="sm" variant={apps.length ? 'secondary' : 'default'} onClick={() => grant({})}>
                    {t('Allow main display')}
                  </Button>
                )}
                {locked && (
                  <p className="m-0 basis-full text-caption text-muted-foreground" role="status">
                    {t(
                      'This Mac is locked, so its main display cannot be used. Allow one app: with “Keep working while the screen is locked” on, the agent works in it behind the lock screen.',
                    )}
                  </p>
                )}
              </div>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                className="self-start"
                onClick={() => {
                  setOpen(false)
                  window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'computer' } }))
                }}
              >
                {t('Open settings')}
              </Button>
            )}
            {appHint && <span className="text-caption text-muted-foreground">{t(appHint)}</span>}
            <ComputerProblem needed={needed} error={error} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
