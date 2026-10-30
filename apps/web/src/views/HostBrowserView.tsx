import { BrowserInputQueue, watchBrowserFrames } from '@ramu/shared/browserLiveViewer'
import { BrowserTabButton, BrowserTabCloseButton, BrowserTabFrame } from '@/components/browser-tab-controls'
import { useHostWriteAccess } from '../composer/useHostWriteAccess'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Plus, RotateCw, X } from 'lucide-react'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import type {
  BrowserDialog,
  BrowserHumanInput,
  BrowserScreenshot,
  BrowserPageSnapshot,
} from '@ramu/shared/browserBridge'
import type { ViewDescriptor } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { Dropdown } from '../Menu'
import { useHost } from '../workspace/HostProvider'
import { useAppSettings } from '../settings/AppSettings'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { addressFrom, browserFaviconFrom } from '@ramu/shared/browserLinks'
import { useSearchEngine } from './searchEngine'
import { takeBrowserNavigation, onBrowserNavigation } from './browserNavigation'
import { takeWantedTab, onWantedTab, NEW_TAB } from './browserPane'
import { HostBrowserDownloads } from './HostBrowserDownloads'

/** Live compositor frames over the authenticated host connection. Native desktop tabs use BrowserView directly. */
export function HostBrowserView({
  taskId,
  view,
  visible,
}: {
  taskId: string
  view: Extract<ViewDescriptor, { kind: 'browser' }>
  visible: boolean
}) {
  const host = useHost()
  const { viewOnly, canWrite } = useHostWriteAccess()
  const { preferences } = useAppSettings()
  const search = useSearchEngine()
  const [tabs, setTabs] = useState<BrowserTabInfo[]>([])
  const [selected, setSelected] = useState(view.tabId ?? '')
  const [image, setImage] = useState<BrowserScreenshot | null>(null)
  const [owned, setOwned] = useState<number | null>(null)
  const [address, setAddress] = useState(view.url ?? '')
  const [text, setText] = useState('')
  const [privateText, setPrivateText] = useState(true)
  const [dialog, setDialog] = useState<BrowserDialog | null>(null)
  const [dialogText, setDialogText] = useState('')
  const [pageText, setPageText] = useState('')
  const [observation, setObservation] = useState<BrowserPageSnapshot | null>(null)
  const [uploadPath, setUploadPath] = useState('')
  const [uploadRef, setUploadRef] = useState('')
  useEffect(() => {
    setPageText('')
    setImage(null)
    setDialog(null)
    setDialogText('')
    setObservation(null)
    setUploadPath('')
    setUploadRef('')
  }, [selected])
  const [error, setError] = useState('')
  const [frameError, setFrameError] = useState('')
  const [frameReady, setFrameReady] = useState(false)
  const [foreground, setForeground] = useState(!document.hidden)
  const inputQueue = useRef<BrowserInputQueue | null>(null)
  const [busy, setBusy] = useState(false)
  const editing = useRef(false)
  const addressEdited = useRef(false)
  const invokeHost = host.invoke
  const tab = tabs.find((tab) => tab.id === selected) ?? tabs[0]
  const tabId = tab?.id
  const generation = tab?.generation
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const current = useRef(tab)
  current.current = tab
  const controlled = !viewOnly && !!tab && tab.controller === 'human' && tab.generation === owned && !tab.paused
  const readyGeneration = useRef('')
  const controlKey = tab ? `${tab.id}:${tab.generation}` : ''
  if (tab?.inputReady) readyGeneration.current = controlKey
  const own = controlled && readyGeneration.current === controlKey && visible && foreground && frameReady
  const scope = `${host.id}:${taskId}`
  const latest = useRef(scope)
  latest.current = scope
  const allowed = useCallback(() => latest.current === scope && canWrite(), [scope, canWrite])
  const act = async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    if (!allowed()) return undefined
    setBusy(true)
    setError('')
    try {
      const result = await work()
      return allowed() ? result : undefined
    } catch (error) {
      if (latest.current === scope) setError(t(errorText(error)))
      return undefined
    } finally {
      if (latest.current === scope) setBusy(false)
    }
  }
  const open = async (raw: string, newTab = false) => {
    if (!allowed()) return
    const url = addressFrom(raw, search.template)
    if (!url) {
      setError(t('Enter a web address or something to search for.'))
      return
    }
    if (tab && !newTab) {
      const next = await act(() => host.invoke('hostBrowser.navigate', taskId, tab.id, url))
      if (next) {
        setSelected(next.id)
        addressEdited.current = false
        setAddress(next.url)
      }
    } else {
      const result = await act(() =>
        host.invoke('hostBrowser.open', taskId, url, preferences.agentBrowser?.defaultProfileId),
      )
      if (result) {
        setSelected(result.tab.id)
        setOwned(result.tab.generation)
        addressEdited.current = false
        setAddress(result.tab.url)
      }
    }
  }
  useEffect(() => {
    if (!visible || !foreground || viewOnly) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    let requested = false
    const poll = async () => {
      try {
        if (document.hidden || !allowed()) return
        const tabs = await host.invoke('hostBrowser.list', taskId)
        if (!active || !allowed()) return
        setTabs(tabs)
        const wanted = takeWantedTab(view.id)
        if (wanted && wanted !== NEW_TAB) setSelected(wanted)
        if (wanted === NEW_TAB) {
          setSelected('')
          addressEdited.current = true
          setAddress('')
          current.current = undefined
          setOwned(null)
          setImage(null)
        }
        const navigation = takeBrowserNavigation(view.id, taskId)
        if (navigation) {
          const result = await host.invoke(
            'hostBrowser.open',
            taskId,
            navigation,
            preferences.agentBrowser?.defaultProfileId,
          )
          if (!active || !allowed()) return
          setSelected(result.tab.id)
          setAddress(result.tab.url)
          setOwned(result.tab.generation)
        }
        const tab =
          tabs.find((tab) => tab.id === current.current?.id) ??
          tabs.find((tab) => tab.id === selectedRef.current) ??
          tabs[0]
        if (tab) {
          if (!editing.current && !addressEdited.current) setAddress(tab.url)
          const dialog = await host.invoke('hostBrowser.dialog', taskId, tab.id)
          if (!active || !allowed()) return
          setDialog((previous) => {
            if (previous?.id !== dialog?.id) setDialogText('')
            return dialog
          })
        } else setImage(null)
        setError('')
      } catch (error) {
        if (active) setError(t(errorText(error)))
      } finally {
        requested = false
        if (active && allowed())
          timer = setTimeout(() => {
            requested = true
            void poll()
          }, 750)
      }
    }
    const refresh = () => {
      if (!requested && allowed()) {
        clearTimeout(timer)
        requested = true
        void poll()
      }
    }
    const offNavigation = onBrowserNavigation(refresh)
    const offWanted = onWantedTab(refresh)
    refresh()
    return () => {
      active = false
      clearTimeout(timer)
      offNavigation()
      offWanted()
      if (allowed()) void host.invoke('hostBrowser.disconnect').catch(() => {})
    }
  }, [
    host,
    taskId,
    visible,
    foreground,
    view.id,
    preferences.agentBrowser?.defaultProfileId,
    viewOnly,
    canWrite,
    allowed,
  ])
  useEffect(() => {
    const changed = () => setForeground(!document.hidden)
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])
  useEffect(() => {
    setFrameReady(false)
    setImage(null)
    setFrameError('')
    if (!visible || !foreground || viewOnly || !tabId || !allowed()) return
    return watchBrowserFrames({
      next: (after) => invokeHost('hostBrowser.nextFrame', taskId, tabId, after),
      fallback: () => invokeHost('hostBrowser.frame', taskId, tabId),
      show: (frame) => {
        if (allowed()) setImage(frame)
      },
      ready: (value) => {
        if (allowed()) setFrameReady(value)
      },
      error: (message) => {
        if (allowed()) setFrameError(message)
      },
    })
  }, [invokeHost, taskId, tabId, visible, foreground, viewOnly, allowed])
  useEffect(() => {
    if (!controlled || !visible || !foreground || !frameReady || !tabId || generation === undefined) return
    const queue = new BrowserInputQueue(async (input) => {
      if (!allowed()) throw new Error(t('Browser control changed.'))
      await invokeHost('hostBrowser.input', taskId, tabId, generation, input)
    })
    inputQueue.current = queue
    return () => {
      queue.close()
      if (inputQueue.current === queue) inputQueue.current = null
    }
  }, [invokeHost, taskId, tabId, generation, controlled, visible, foreground, frameReady, allowed])
  const input = (input: BrowserHumanInput) => {
    if (!allowed() || !own || busy || (input.kind === 'scroll' && !input.x && !input.y)) return
    void inputQueue.current?.push(input).catch((error) => {
      if (allowed()) setError(t(errorText(error)))
    })
  }
  const page = useRef<HTMLDivElement | null>(null)
  const wheelAction = useRef<(event: WheelEvent) => void>(() => {})
  wheelAction.current = (event) => {
    if (!own || busy) return
    event.preventDefault()
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (image?.height ?? 768) : 1
    input({
      kind: 'scroll',
      x: Math.max(-2000, Math.min(2000, event.deltaX * unit)),
      y: Math.max(-2000, Math.min(2000, event.deltaY * unit)),
    })
  }
  const wheelListener = useRef((event: WheelEvent) => wheelAction.current(event)).current
  const attachPage = useCallback(
    (node: HTMLDivElement | null) => {
      page.current?.removeEventListener('wheel', wheelListener)
      page.current = node
      node?.addEventListener('wheel', wheelListener, { passive: false })
    },
    [wheelListener],
  )
  useEffect(() => () => attachPage(null), [attachPage])
  return (
    <>
      {viewOnly && (
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6">
          <p role="status" className="max-w-md text-control text-muted-foreground">
            {t(
              'This device can view threads, but cannot open the host browser. Ask the host owner to pair it with full access.',
            )}
          </p>
        </div>
      )}
      <div
        hidden={viewOnly}
        inert={viewOnly}
        style={{ display: viewOnly ? 'none' : undefined }}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <div
          role="tablist"
          aria-label={t('Browser tabs')}
          className="flex items-center gap-1 overflow-x-auto border-b border-(--line) p-1"
        >
          {tabs.map((entry) => (
            <BrowserTabFrame key={entry.id} active={entry.id === tab?.id}>
              <BrowserTabButton
                aria-selected={entry.id === tab?.id}
                disabled={viewOnly}
                onClick={() => {
                  if (!allowed()) return
                  setSelected(entry.id)
                  addressEdited.current = false
                  setAddress(entry.url)
                  setImage(null)
                  setOwned(null)
                }}
              >
                {browserFaviconFrom(entry.url, entry.faviconUrl) && (
                  <img
                    alt=""
                    aria-hidden="true"
                    width={14}
                    height={14}
                    referrerPolicy="no-referrer"
                    src={entry.faviconUrl}
                    onError={(event) => {
                      event.currentTarget.style.visibility = 'hidden'
                    }}
                  />
                )}
                <span className="truncate">{entry.title || entry.url}</span>
              </BrowserTabButton>
              {entry.id === tab?.id && (
                <BrowserTabCloseButton
                  aria-label={t('Close tab')}
                  disabled={!controlled || busy}
                  onClick={() => void act(() => host.invoke('hostBrowser.close', taskId, entry.id))}
                >
                  <X size={12} />
                </BrowserTabCloseButton>
              )}
            </BrowserTabFrame>
          ))}
        </div>
        <form
          className="flex items-center gap-1 border-b border-(--line) p-2"
          onSubmit={(event) => {
            event.preventDefault()
            void open(address)
          }}
        >
          {(['back', 'forward', 'reload'] as const).map((direction, index) => {
            const Icon = [ArrowLeft, ArrowRight, RotateCw][index]!
            return (
              <Button
                key={direction}
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t(direction === 'back' ? 'Back' : direction === 'forward' ? 'Forward' : 'Reload')}
                disabled={!own || busy}
                onClick={() => tab && void act(() => host.invoke('hostBrowser.history', taskId, tab.id, direction))}
              >
                <Icon size={14} />
              </Button>
            )
          })}
          <Input
            className="min-w-0 flex-1"
            aria-label={t('Address')}
            value={address}
            onFocus={() => {
              editing.current = true
            }}
            onBlur={() => {
              editing.current = false
            }}
            onChange={(event) => {
              addressEdited.current = true
              setAddress(event.target.value)
            }}
            disabled={!!tab && !own}
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t('New browser tab')}
            onClick={() => void open(new URL(search.template).origin, true)}
          >
            <Plus size={14} />
          </Button>
          <HostBrowserDownloads canAccess={allowed} taskId={taskId} tabId={tab?.id} own={own} />
          {tab && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const next = await host.invoke(
                    controlled ? 'hostBrowser.release' : 'hostBrowser.take',
                    taskId,
                    tab.id,
                  )
                  if (latest.current === scope) setOwned(controlled ? null : next.generation)
                })
              }
            >
              {controlled ? t('Give control to agent') : t('Take control')}
            </Button>
          )}
        </form>
        <p className="m-0 px-3 py-1 text-caption text-muted-foreground">
          {t('Browser runs on the selected execution host. Sign-ins stay there.')}
        </p>
        {(error || frameError) && (
          <p role="status" className="m-0 px-3 py-1 text-caption">
            {error || t(frameError)}
          </p>
        )}
        {tab && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void act(async () => {
                const snapshot = await host.invoke('hostBrowser.read', taskId, tab.id)
                setPageText(snapshot.text)
                setObservation(snapshot)
                setUploadRef(String(snapshot.elements.find((element) => element.type === 'file')?.ref ?? ''))
              })
            }
          >
            {t('Read page text')}
          </Button>
        )}
        {pageText && (
          <div
            role="region"
            aria-label={t('Page text')}
            className="max-h-40 overflow-auto whitespace-pre-wrap p-3 text-caption"
          >
            {pageText}
          </div>
        )}
        {own && observation?.elements.some((element) => element.type === 'file') && (
          <form
            className="flex items-center gap-2 border-b border-(--line) p-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (tab && uploadRef)
                void act(async () => {
                  const result = await host.invoke(
                    'hostBrowser.upload',
                    taskId,
                    tab.id,
                    tab.generation,
                    observation.snapshot,
                    Number(uploadRef),
                    uploadPath,
                  )
                  if (!result.ok) throw new Error(result.reason ?? 'Read the page again before uploading.')
                  setObservation(null)
                  setUploadPath('')
                })
            }}
          >
            <Dropdown
              label={t('Website file input')}
              value={uploadRef}
              onChange={setUploadRef}
              options={observation.elements
                .filter((element) => element.type === 'file')
                .map((element) => ({ value: String(element.ref), label: element.name || t('Website file input') }))}
            />
            <Input
              aria-label={t('Upload from workspace path')}
              value={uploadPath}
              maxLength={4000}
              onChange={(event) => setUploadPath(event.target.value)}
              placeholder={t('Relative workspace file (maximum 8 MiB)')}
            />
            <Button size="sm" disabled={busy || !uploadPath || !uploadRef}>
              {t('Upload')}
            </Button>
          </form>
        )}

        {dialog && (
          <div role="alertdialog" aria-label={t('Website dialog')} className="border-b border-(--line) p-2">
            <p>{dialog.message}</p>
            {dialog.type === 'prompt' && (
              <Input
                aria-label={t('Website dialog answer')}
                value={dialogText}
                onChange={(event) => setDialogText(event.target.value)}
              />
            )}
            {[false, true].map((accept) => (
              <Button
                key={String(accept)}
                disabled={!controlled || busy}
                onClick={() =>
                  tab &&
                  void act(() => host.invoke('hostBrowser.answerDialog', taskId, tab.id, dialog.id, accept, dialogText))
                }
              >
                {accept ? t('OK') : t('Cancel')}
              </Button>
            ))}
          </div>
        )}
        <div
          className="min-h-0 flex-1 overflow-auto bg-background"
          tabIndex={own ? 0 : -1}
          aria-label={t('Page')}
          onKeyDown={(event) => {
            if (
              !own ||
              event.ctrlKey ||
              event.metaKey ||
              event.altKey ||
              !/^(Enter|Escape|Tab|Arrow(Up|Down|Left|Right)|Backspace|Delete|Home|End|PageUp|PageDown)$/.test(
                event.key,
              )
            )
              return
            event.preventDefault()
            input({ kind: 'key', key: event.key })
          }}
          ref={attachPage}
        >
          {image ? (
            <img
              draggable={false}
              alt={t('Browser page on the execution host')}
              className="block w-full"
              src={`data:${image.mimeType};base64,${image.data}`}
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect()
                input({
                  kind: 'click',
                  x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
                  y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
                  button: 'left',
                  clickCount: 1,
                })
              }}
            />
          ) : (
            <p className="p-6 text-center text-muted-foreground">
              {t('Choose a tab or enter an address to open a page.')}
            </p>
          )}
        </div>
        {own && (
          <form
            className="flex gap-2 border-t border-(--line) p-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (text && tab)
                void act(async () => {
                  if (!inputQueue.current) throw new Error('Take control again to continue.')
                  await inputQueue.current.push({ kind: 'text', text })
                  setText((current) => (current === text ? '' : current))
                })
            }}
          >
            <Input
              type={privateText ? 'password' : 'text'}
              autoComplete="off"
              aria-label={t('Text for the focused website field')}
              maxLength={2000}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={!privateText}
              onClick={() => setPrivateText(!privateText)}
            >
              {privateText ? t('Show text') : t('Hide text')}
            </Button>
            <Button size="sm" disabled={busy || !text}>
              {t('Type')}
            </Button>
          </form>
        )}
      </div>
    </>
  )
}
