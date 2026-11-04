import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes } from 'react'
import { ExternalLink, Globe, Monitor, PictureInPicture2, Square, X } from 'lucide-react'
import { livePlacement, livePosition, liveState, liveSurface, type LiveSurface } from '@ramu/shared/liveView'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import type { ComputerSessionSummary } from '@ramu/shared/api'
import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/desktop-checkbox'
import { notifyError } from '../chat/Notifications'
import { useViewOnly } from '../composer/useViewOnly'
import { t, useLanguage } from '../i18n'
import { ramu } from '../ipc'
import { errorText } from '../lib/errors'
import { useComputers } from '../workspace/computers'
import { useHostOverviews } from '../workspace/hostOverview'
import { HostProvider, useHost } from '../workspace/HostProvider'
import { useHostSelection } from '../workspace/HostSelection'
import { useAppSettings } from '../settings/AppSettings'
import { closeLiveView, pinLiveSurface, placeLiveView, setLiveWindow, useLiveViewPin } from './liveViewStore'

const FRAME_MS = 1000
/** Inside Ramu's window the view keeps clear of its edges and of the title bar. */
const MARGIN = 16,
  TITLE_BAR = 56,
  NUDGE = 24
const boundsOf = () => ({ width: window.innerWidth, height: window.innerHeight, margin: MARGIN, top: TITLE_BAR })

/** What the thread has to show: computer use while granted, and its browser tabs. Read only while the view is open. */
function useSurfaces(taskId: string) {
  const { id: hostId, invoke } = useHost()
  const [computer, setComputer] = useState<ComputerSessionSummary | null>(null)
  const [tabs, setTabs] = useState<(BrowserTabInfo & { host: boolean })[]>([])
  useEffect(() => {
    let live = true
    const read = async () => {
      const session = await invoke('computer.session', taskId).catch(() => null)
      const hostTabs = await invoke('hostBrowser.list', taskId).catch(() => [] as BrowserTabInfo[])
      const desktopTabs = await ramu.invoke('browser.list', hostId, taskId).catch(() => [] as BrowserTabInfo[])
      if (!live) return
      setComputer(session)
      setTabs([
        ...hostTabs.map((tab) => ({ ...tab, host: true })),
        ...desktopTabs.map((tab) => ({ ...tab, host: false })),
      ])
    }
    void read()
    const timer = setInterval(() => void read(), 3000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [hostId, invoke, taskId])
  return { computer, tabs }
}

/** The newest picture of the surface, sized for the view; nothing is read while the window is hidden. */
function useFrame(taskId: string, surface: LiveSurface | null) {
  const { id: hostId, invoke } = useHost()
  const [image, setImage] = useState<string | null>(null)
  const key = surface ? JSON.stringify(surface) : ''
  useEffect(() => {
    setImage(null)
    if (!surface) return
    let live = true
    let hash: string | undefined
    let timer: ReturnType<typeof setTimeout>
    const read = async () => {
      try {
        if (document.visibilityState === 'visible') {
          if (surface.kind === 'computer') {
            const frame = await invoke('computer.frame', taskId, ...(hash ? [hash] : []))
            hash = frame.hash
            if (live && !frame.unchanged) setImage(`data:${frame.mimeType};base64,${frame.data}`)
          } else {
            const frame = surface.host
              ? await invoke('hostBrowser.frame', taskId, surface.tabId)
              : await ramu.invoke('browser.preview', hostId, taskId, surface.tabId)
            if (live && frame) setImage(`data:${frame.mimeType};base64,${frame.data}`)
          }
        }
      } catch {
        // The header still says where things stand; the picture catches up on the next read.
      } finally {
        if (live) timer = setTimeout(() => void read(), FRAME_MS)
      }
    }
    void read()
    return () => {
      live = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the surface it shows
  }, [hostId, invoke, taskId, key])
  return image
}

function Body({
  taskId,
  onOpen,
  onClose,
  inWindow,
  handle,
}: {
  taskId: string
  onOpen: () => void
  onClose: () => void
  inWindow: boolean
  /** Makes the header the handle that moves the view inside Ramu's window. */
  handle?: HTMLAttributes<HTMLDivElement>
}) {
  useLanguage()
  const pin = useLiveViewPin()
  const host = useHost()
  const viewOnly = useViewOnly()
  const computers = useComputers()
  const overview = useHostOverviews([host.id])[0]?.data
  const task = overview?.tasks.find((entry) => entry.id === taskId)
  const { computer, tabs } = useSurfaces(taskId)
  const surface = liveSurface(pin ?? {}, { computer: !!computer, tabs })
  const image = useFrame(taskId, surface)
  const online = host.status === 'connected'
  const state = liveState(task?.status)
  const hostName = computers?.computers.find((entry) => entry.id === host.id)?.name ?? ''
  const stopAgent = async () => {
    try {
      const sessions = await host.invoke('agent.list', taskId)
      const session = sessions.filter((entry) => !entry.parentId).at(-1)
      if (session) await host.invoke('agent.stop', session.id)
    } catch (error) {
      notifyError(errorText(error))
    }
  }
  const stateText =
    state === 'needs-you'
      ? t('Needs you')
      : state === 'working'
        ? t('Working')
        : state === 'failed'
          ? t('Failed')
          : state === 'finished'
            ? t('Finished')
            : t('Idle')
  return (
    <>
      <div {...handle} className={`flex items-center gap-1.5 px-2 pt-1.5 ${handle?.className ?? ''}`}>
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-control font-medium">{task?.title ?? t('Thread')}</p>
          <p
            className={`m-0 truncate text-caption ${state === 'needs-you' ? 'text-warn' : state === 'failed' ? 'text-bad' : 'text-muted-foreground'}`}
            role="status"
          >
            {[online ? stateText : t('Reconnecting…'), hostName].filter(Boolean).join(' · ')}
          </p>
        </div>
        {!inWindow && (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('Keep on top of other apps')}
              title={t('Keep on top of other apps')}
              onClick={() => {
                setLiveWindow(true)
                void ramu.invoke('live.window', true, pin?.hideFromSharing ?? true).catch((error) => {
                  setLiveWindow(false)
                  notifyError(errorText(error))
                })
              }}
            >
              <PictureInPicture2 size={12} />
            </Button>
          </>
        )}
        <Button variant="ghost" size="icon-xs" aria-label={t('Close live view')} onClick={onClose}>
          <X size={13} />
        </Button>
      </div>
      <div
        className={`relative mx-2 mt-1.5 overflow-hidden rounded-(--radius-s) bg-muted ${inWindow ? 'min-h-0 flex-1' : 'aspect-video'}`}
      >
        {image && online ? (
          <img
            alt={t('Live view of {0}', { 0: task?.title ?? '' })}
            src={image}
            className="h-full w-full object-contain"
          />
        ) : (
          <p className="m-0 grid h-full place-items-center p-3 text-center text-caption text-muted-foreground">
            {!online
              ? t('Reconnecting…')
              : surface
                ? t('Waiting for a picture…')
                : t('Nothing to show yet. The view follows Browser and Computer when the agent uses them.')}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
        {(computer || tabs.length > 1) && (
          <div className="flex gap-0.5" role="group" aria-label={t('Show')}>
            {computer && (
              <Button
                variant={surface?.kind === 'computer' ? 'secondary' : 'ghost'}
                size="icon-xs"
                aria-label={t('Computer')}
                aria-pressed={surface?.kind === 'computer'}
                onClick={() => pinLiveSurface({ kind: 'computer' })}
              >
                <Monitor size={12} />
              </Button>
            )}
            {tabs.map((tab) => (
              <Button
                key={tab.id}
                variant={surface?.kind === 'browser' && surface.tabId === tab.id ? 'secondary' : 'ghost'}
                size="icon-xs"
                aria-label={tab.title || tab.url}
                title={tab.title || tab.url}
                onClick={() => pinLiveSurface({ kind: 'browser', tabId: tab.id, host: tab.host })}
              >
                <Globe size={12} />
              </Button>
            ))}
          </div>
        )}
        {inWindow && (
          <label className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <Checkbox
              checked={pin?.hideFromSharing ?? true}
              onCheckedChange={(checked) => {
                setLiveWindow(true, !!checked)
                void ramu.invoke('live.window', true, !!checked).catch(() => {})
              }}
            />
            {t('Hide from screen sharing')}
          </label>
        )}
        <span className="flex-1" />
        {!viewOnly && computer && (
          <Button variant="ghost" size="xs" onClick={() => void host.invoke('computer.stop', taskId).catch(() => {})}>
            {t('Stop computer use')}
          </Button>
        )}
        {!viewOnly && (
          <Button variant="ghost" size="xs" disabled={!online} onClick={() => void stopAgent()}>
            <Square size={10} />
            {t('Stop the agent')}
          </Button>
        )}
        <Button variant="ghost" size="xs" disabled={!online} onClick={onOpen}>
          <ExternalLink size={11} />
          {t('Open')}
        </Button>
      </div>
    </>
  )
}

/** One small view of a thread's Browser or Computer that stays in a corner while the person works elsewhere in Ramu. */
export function LiveView() {
  const pin = useLiveViewPin()
  const { preferences } = useAppSettings()
  const { select } = useHostSelection()
  useEffect(() => {
    const offClosed = ramu.on('live:closed', () => setLiveWindow(false))
    const offOpen = ramu.on('live:open', ({ hostId, taskId }) => select(hostId, { kind: 'task', taskId }))
    return () => {
      offClosed()
      offOpen()
    }
  }, [select])
  const box = useRef<HTMLElement>(null)
  const [size, setSize] = useState({ width: 320, height: 320 })
  const [, setViewport] = useState(0)
  // While dragged, the view follows the pointer; on release it saves its share of the free space.
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(null)
  const shown = !!pin && !pin.window && preferences.liveViewDesktop
  useLayoutEffect(() => {
    const element = box.current
    if (!shown || !element) return
    const measure = () => setSize({ width: element.offsetWidth, height: element.offsetHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    const resize = () => setViewport((n) => n + 1)
    window.addEventListener('resize', resize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [shown])
  if (!pin || !shown) return null
  const at = drag ?? livePlacement(pin.position, boundsOf(), size)
  const drop = (left: number, top: number) => placeLiveView(livePosition(left, top, boundsOf(), size))
  const handle: HTMLAttributes<HTMLDivElement> = {
    className: drag ? 'cursor-grabbing' : 'cursor-grab',
    tabIndex: 0,
    role: 'group',
    'aria-label': t('Live view. Drag, or use the arrow keys, to move it.'),
    onPointerDown: (event) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('button, a, input, [role="checkbox"]')) return
      event.preventDefault()
      const start = { x: event.clientX, y: event.clientY, ...at }
      const header = event.currentTarget
      header.setPointerCapture(event.pointerId)
      let last = { left: start.left, top: start.top }
      const move = (next: PointerEvent) => {
        const free = livePlacement({ x: 1, y: 1 }, boundsOf(), size)
        last = {
          left: Math.min(free.left, Math.max(MARGIN, start.left + next.clientX - start.x)),
          top: Math.min(free.top, Math.max(TITLE_BAR, start.top + next.clientY - start.y)),
        }
        setDrag(last)
      }
      const end = () => {
        header.removeEventListener('pointermove', move)
        header.removeEventListener('pointerup', end)
        header.removeEventListener('pointercancel', end)
        drop(last.left, last.top)
        setDrag(null)
      }
      header.addEventListener('pointermove', move)
      header.addEventListener('pointerup', end)
      header.addEventListener('pointercancel', end)
    },
    onKeyDown: (event) => {
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
      if (!step || event.target !== event.currentTarget) return
      event.preventDefault()
      drop(at.left + step[0]! * NUDGE, at.top + step[1]! * NUDGE)
    },
  }
  return (
    <aside
      ref={box}
      className="fixed z-50 w-[320px] max-w-[calc(100vw-32px)] rounded-(--radius-m) border border-edge bg-card text-foreground shadow-(--shadow-float)"
      style={{ left: at.left, top: at.top }}
      aria-label={t('Live view')}
    >
      <HostProvider hostId={pin.hostId}>
        <Body
          key={`${pin.hostId}:${pin.taskId}`}
          taskId={pin.taskId}
          inWindow={false}
          onOpen={() => select(pin.hostId, { kind: 'task', taskId: pin.taskId })}
          onClose={closeLiveView}
          handle={handle}
        />
      </HostProvider>
    </aside>
  )
}

/** The live view in its own window above other apps: the same view, filling the window. */
export function LiveWindowView() {
  const pin = useLiveViewPin()
  useEffect(() => {
    if (!pin) void ramu.invoke('live.close').catch(() => {})
  }, [pin])
  if (!pin) return null
  return (
    <main className="flex h-screen flex-col bg-card text-foreground" aria-label={t('Live view')}>
      <HostProvider hostId={pin.hostId}>
        <Body
          key={`${pin.hostId}:${pin.taskId}`}
          taskId={pin.taskId}
          inWindow
          onOpen={() => void ramu.invoke('live.open', pin.hostId, pin.taskId).catch(() => {})}
          onClose={() => {
            closeLiveView()
            void ramu.invoke('live.close').catch(() => {})
          }}
        />
      </HostProvider>
    </main>
  )
}
