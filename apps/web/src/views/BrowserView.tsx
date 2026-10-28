import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, Hand, Plus, RotateCw } from 'lucide-react'
import type { BrowserDialog } from '@ramu/shared/browserBridge'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import type { ViewDescriptor } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { t, useLanguage } from '../i18n'
import { ramu, bridge } from '../ipc'
import { errorText } from '../lib/errors'
import { addressFrom } from './browserAddress'
import { openOverlays, paneCovered } from './browserOverlay'
import { NEW_TAB, onWantedTab, takeWantedTab } from './browserPane'
import { onBrowserNavigation, takeBrowserNavigation } from './browserNavigation'
import { BrowserTabChip, type BrowserTabActions } from './BrowserTabChip'
import { BrowserDownloads } from './BrowserDownloads'
import { HostBrowserView } from './HostBrowserView'
import { useSearchEngine } from './searchEngine'
import { useAppSettings } from '../settings/AppSettings'
import { useHost } from '../workspace/HostProvider'
import { useWorkspace } from '../workspace/workspace'

const controllerText = (controller: BrowserTabInfo['controller']) =>
  controller === 'agent'
    ? t('The agent is controlling this page')
    : controller === 'human'
      ? t('You are in control')
      : ''

/**
 * One integrated-browser tab for this thread. The page itself is a native view the desktop shell places over this
 * pane's rectangle; this component owns the address bar and reports where the pane is. Hiding or closing the pane
 * never destroys the page: only the tab's own close does.
 */
export function BrowserView(props: {
  taskId: string
  view: Extract<ViewDescriptor, { kind: 'browser' }>
  visible: boolean
}) {
  const host = useHost()
  const [hosted, setHosted] = useState(!host.isLocal)
  useEffect(() => {
    let active = true
    const refresh = () => {
      void host
        .invoke('hostBrowser.status')
        .then((status) => {
          if (active) setHosted(!host.isLocal || !!status.enabled)
        })
        .catch(() => {})
    }
    refresh()
    const off = bridge.on('hostBrowser:changed', (_payload, from) => {
      if (from === host.id || (!from && host.isLocal)) refresh()
    })
    return () => {
      active = false
      off()
    }
  }, [host])
  return hosted ? <HostBrowserView key={`${host.id}:${props.taskId}`} {...props} /> : <LocalBrowserView {...props} />
}

export function LocalBrowserView({
  taskId,
  view,
  visible,
}: {
  taskId: string
  view: Extract<ViewDescriptor, { kind: 'browser' }>
  visible: boolean
}) {
  useLanguage()
  const host = useHost().id
  const ws = useWorkspace()
  const scope = `${host}:${taskId}:${view.id}`
  const latestScope = useRef(scope)
  const viewEpoch = useRef(0)
  if (latestScope.current !== scope) {
    latestScope.current = scope
    viewEpoch.current += 1
  }
  // New tabs follow the profile chosen in Settings → Browser; it is not picked per tab here.
  const { preferences } = useAppSettings()
  const profile = view.profileId ?? preferences.agentBrowser?.defaultProfileId ?? 'default'
  const [listed, setListed] = useState(false)
  const [websiteDialog, setWebsiteDialog] = useState<BrowserDialog | null>(null)
  const dialogRef = useRef(websiteDialog)
  dialogRef.current = websiteDialog
  const [dialogText, setDialogText] = useState('')
  const [dialogBusy, setDialogBusy] = useState(false)
  const search = useSearchEngine()
  const [tab, setTabState] = useState<BrowserTabInfo | null>(null)
  // The tab the person last chose, readable by a list refresh that began before the choice and ends after it, so a
  // slow refresh never switches the pane back to the tab it was on.
  const chosen = useRef<string | undefined>(undefined)
  const navigationGeneration = useRef(0)
  const setTab = useCallback((next: BrowserTabInfo | null) => {
    chosen.current = next?.id
    setTabState(next)
  }, [])
  const editingAddress = useRef(false)
  const startingNew = useRef(false)
  const [threadTabs, setThreadTabs] = useState<BrowserTabInfo[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [address, setAddress] = useState(view.url ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const area = useRef<HTMLDivElement>(null)
  const pane = useRef<HTMLDivElement>(null)
  const [covered, setCovered] = useState(false)
  const tabId = tab?.id

  const run = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
      const epoch = viewEpoch.current
      setError(null)
      setBusy(true)
      try {
        const result = await work()
        return latestScope.current === scope && viewEpoch.current === epoch ? result : undefined
      } catch (reason) {
        if (latestScope.current === scope && viewEpoch.current === epoch) setError(t(errorText(reason)))
        return undefined
      } finally {
        if (latestScope.current === scope && viewEpoch.current === epoch) setBusy(false)
      }
    },
    [scope],
  )

  const open = useCallback(
    async (raw: string) => {
      const url = addressFrom(raw, search.template)
      if (!url) return setError(t('Enter a web address or something to search for.'))
      if (tabId) {
        const next = await run(() => ramu.invoke('browser.navigate', host, taskId, tabId, url))
        if (next) {
          setTab(next)
          setAddress(next.url)
        }
        return
      }
      const opened = await run(() => ramu.invoke('browser.open', host, taskId, url, profile))
      if (opened) {
        startingNew.current = false
        setTab(opened.tab)
        setAddress(opened.tab.url)
        if (opened.profileFellBack)
          setError(t('The selected profile is no longer available. This tab opened in Default.'))
      }
    },
    [host, taskId, tabId, run, profile, search.template, setTab],
  )

  // A new tab opens the search engine's own page, ready to search from, rather than an empty pane.
  const newTab = useCallback(async () => {
    let home: string
    try {
      home = new URL(search.template).origin
    } catch {
      home = 'https://duckduckgo.com'
    }
    startingNew.current = false
    const opened = await run(() => ramu.invoke('browser.open', host, taskId, home, profile))
    if (!opened) return
    setTab(opened.tab)
    setAddress('')
    editingAddress.current = false
  }, [host, taskId, profile, run, search.template, setTab])
  const newTabRef = useRef(newTab)
  newTabRef.current = newTab

  // Read native ownership/navigation changes. Fence late reads when this pane changes host or thread.
  useEffect(() => {
    if (!visible) return
    let active = true,
      revision = 0
    const refresh = async () => {
      const mine = ++revision
      try {
        const tabs = await ramu.invoke('browser.list', host, taskId)
        if (!active || mine !== revision) return
        setThreadTabs(tabs)
        setListed(true)
        setListError(null)
        const requestedURL = takeBrowserNavigation(view.id, taskId)
        if (requestedURL) {
          const generation = ++navigationGeneration.current
          const opened = await run(() => ramu.invoke('browser.open', host, taskId, requestedURL, profile))
          if (active && generation === navigationGeneration.current && opened) {
            setTab(opened.tab)
            setAddress(opened.tab.url)
          }
          return
        }
        const want = takeWantedTab(view.id)
        if (want === NEW_TAB) {
          void newTabRef.current()
          return
        }
        const current =
          (want ? tabs.find((candidate) => candidate.id === want) : undefined) ??
          tabs.find((candidate) => candidate.id === (chosen.current ?? tabId ?? view.tabId)) ??
          (!tabId && !view.tabId && !view.url && !startingNew.current ? tabs[0] : undefined)
        setTab(current ?? null)
        if (!current) setWebsiteDialog(null)
        else {
          const dialog = await ramu.invoke('browser.dialog', host, taskId, current.id)
          if (!active || mine !== revision) return
          if (dialogRef.current?.id !== dialog?.id) setDialogText('')
          setWebsiteDialog(dialog)
        }
        if (current) {
          if (!editingAddress.current) setAddress(current.url)
        }
      } catch (reason) {
        if (active && mine === revision) setListError(t(errorText(reason)))
      }
    }
    const off = ramu.on('browser:changed', () => {
      void refresh()
    })
    const offWanted = onWantedTab(() => void refresh())
    const offNavigation = onBrowserNavigation(() => void refresh())
    void refresh()
    return () => {
      active = false
      off()
      offWanted()
      offNavigation()
    }
  }, [host, taskId, tabId, visible, view.id, view.tabId, view.url, profile, run, setTab])

  // Restored panes retain their address without loading a website.
  useEffect(() => {
    setTab(null)
    setThreadTabs([])
    setListed(false)
    setWebsiteDialog(null)
    setDialogBusy(false)
    setListError(null)
    startingNew.current = false
    setAddress(view.url ?? '')
    setError(null)
    setBusy(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [scope] by design; the values it reads beyond these are current as of that run
  }, [scope])
  // Dialogs, menus and popovers draw below the native page, so it steps aside while one reaches into the pane.
  useEffect(() => {
    const root = pane.current
    const element = area.current
    if (!visible || !tabId || !root || !element) return setCovered(false)
    let frame = 0
    const check = () => {
      frame = 0
      setCovered(paneCovered(element.getBoundingClientRect(), openOverlays(document, root)))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check)
    }
    check()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role', 'aria-modal', 'hidden', 'style'],
    })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [visible, tabId])

  // Place the native page over the pane while it is visible; take it off screen when it is not.
  useEffect(() => {
    if (!tabId) return
    const element = area.current
    if (!visible || covered || !element) {
      void ramu.invoke('browser.hide', host, taskId, tabId).catch(() => {})
      return
    }
    const place = () => {
      const rect = element.getBoundingClientRect()
      void ramu
        .invoke('browser.show', host, taskId, tabId, { x: rect.x, y: rect.y, width: rect.width, height: rect.height })
        .catch(() => {})
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(element)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      void ramu.invoke('browser.hide', host, taskId, tabId).catch(() => {})
    }
  }, [visible, covered, tabId, host, taskId])

  const call = (method: 'browser.back' | 'browser.forward' | 'browser.reload') =>
    tabId && void run(() => ramu.invoke(method, host, taskId, tabId))
  // Closing a tab keeps the pane while the thread has other tabs; the last one closes the pane too.
  const closeOther = async (entry: BrowserTabInfo) => {
    await run(() => ramu.invoke('browser.close', host, taskId, entry.id))
    const rest = threadTabs.filter((candidate) => candidate.id !== entry.id)
    if (entry.id !== tabId) return
    if (!rest.length) return ws.closeView(taskId, view.id)
    startingNew.current = false
    setTab(rest[0]!)
    setAddress(rest[0]!.url)
  }

  const select = (entry: BrowserTabInfo) => {
    navigationGeneration.current++
    startingNew.current = false
    setTab(entry)
    setAddress(entry.url)
    setError(null)
  }
  const closeMany = async (doomed: BrowserTabInfo[], keep: BrowserTabInfo) => {
    await run(async () => {
      for (const entry of doomed) await ramu.invoke('browser.close', host, taskId, entry.id)
    })
    if (doomed.some((entry) => entry.id === tabId)) select(keep)
  }
  const tabActions: BrowserTabActions = {
    select,
    close: (entry) => void closeOther(entry),
    closeOthers: (entry) =>
      void closeMany(
        threadTabs.filter((other) => other.id !== entry.id),
        entry,
      ),
    closeToRight: (entry) =>
      void closeMany(threadTabs.slice(threadTabs.findIndex((other) => other.id === entry.id) + 1), entry),
    duplicate: (entry) =>
      void run(() => ramu.invoke('browser.open', host, taskId, entry.url, entry.profileId)).then((opened) => {
        if (opened) select(opened.tab)
      }),
    reload: (entry) => {
      if (entry.id !== tabId) select(entry)
      void run(() => ramu.invoke('browser.reload', host, taskId, entry.id))
    },
    openExternal: (entry) => void run(() => ramu.invoke('app.openExternal', entry.url)),
    newTab: () => void newTab(),
  }
  const take = async () => {
    if (!tabId) return
    const next = await run(() => ramu.invoke('browser.takeControl', host, taskId, tabId))
    if (next) setTab(next)
  }

  const release = async () => {
    if (!tabId) return
    const next = await run(() => ramu.invoke('browser.giveControl', host, taskId, tabId))
    if (next) setTab(next)
  }

  const answerDialog = async (accept: boolean) => {
    if (!websiteDialog || !tabId || dialogBusy) return
    const source = scope,
      epoch = viewEpoch.current
    setDialogBusy(true)
    try {
      await ramu.invoke(
        'browser.handleDialog',
        host,
        taskId,
        tabId,
        websiteDialog.id,
        accept,
        websiteDialog.type === 'prompt' && accept ? dialogText : undefined,
      )
      if (latestScope.current === source && viewEpoch.current === epoch) setWebsiteDialog(null)
    } catch (reason) {
      if (latestScope.current === source && viewEpoch.current === epoch) setError(t(errorText(reason)))
    } finally {
      if (latestScope.current === source && viewEpoch.current === epoch) setDialogBusy(false)
    }
  }

  return (
    <div ref={pane} className="browser-view flex min-h-0 min-w-0 flex-1 flex-col">
      {threadTabs.length > 0 && (
        <div
          role="tablist"
          aria-label={t('Browser tabs')}
          className="flex flex-none items-center gap-1 overflow-x-auto border-b border-(--line) px-2 py-1"
        >
          {threadTabs.map((entry, index) => (
            <BrowserTabChip
              key={entry.id}
              tab={entry}
              index={index}
              count={threadTabs.length}
              active={entry.id === tabId}
              disabled={busy}
              actions={tabActions}
            />
          ))}
        </div>
      )}
      {websiteDialog && (
        <div className="flex flex-none flex-col gap-2 border-b border-(--line) bg-fill p-3" role="alert">
          <strong className="text-control">{t('Website dialog')}</strong>
          <p className="m-0 whitespace-pre-wrap text-control">{websiteDialog.message}</p>
          <span className="text-caption text-muted-foreground">{t('This message comes from the website.')}</span>
          {websiteDialog.type === 'prompt' && (
            <Input
              aria-label={t('Website prompt answer')}
              value={dialogText}
              maxLength={20000}
              disabled={dialogBusy || tab?.controller !== 'human'}
              onChange={(event) => setDialogText(event.target.value)}
            />
          )}
          <div className="flex gap-2">
            {tab?.controller === 'human' ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={dialogBusy}
                  onClick={() => void answerDialog(false)}
                >
                  {t('Dismiss')}
                </Button>
                <Button type="button" size="sm" disabled={dialogBusy} onClick={() => void answerDialog(true)}>
                  {t('Accept')}
                </Button>
              </>
            ) : (
              <Button type="button" variant="secondary" size="sm" onClick={() => void take()}>
                {t('Take control')}
              </Button>
            )}
          </div>
        </div>
      )}
      <form
        className="flex flex-none items-center gap-1 border-b border-(--line) px-2 py-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (tab && !tab.inputReady) return
          void open(address)
        }}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('Back')}
          disabled={!tabId || busy || !tab?.inputReady}
          onClick={() => call('browser.back')}
        >
          <ArrowLeft size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('Forward')}
          disabled={!tabId || busy || !tab?.inputReady}
          onClick={() => call('browser.forward')}
        >
          <ArrowRight size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('Reload')}
          disabled={!tabId || busy || !tab?.inputReady}
          onClick={() => call('browser.reload')}
        >
          <RotateCw size={14} />
        </Button>
        <Input
          aria-label={t('Web address')}
          placeholder={t('Search or enter a web address')}
          disabled={!!tab && !tab.inputReady}
          value={address}
          onFocus={() => {
            editingAddress.current = true
          }}
          onBlur={() => {
            editingAddress.current = false
          }}
          onChange={(event) => setAddress(event.target.value)}
          className="min-w-0 flex-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('New browser tab')}
          title={t('New browser tab')}
          disabled={busy}
          onClick={() => void newTab()}
        >
          <Plus size={14} />
        </Button>
        <BrowserDownloads
          key={`${host}:${taskId}`}
          host={host}
          taskId={taskId}
          tabId={tabId}
          human={tab?.controller === 'human' && !!tab.inputReady}
        />
        {tab && (tab.controller !== 'human' || tab.paused) && (
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void take()}>
            <Hand size={14} />
            {t('Take control')}
          </Button>
        )}
        {tab?.controller === 'human' && tab.inputReady && (
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void release()}>
            {t('Give control to agent')}
          </Button>
        )}
        {tab && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('Open in system browser')}
            onClick={() => void run(() => ramu.invoke('app.openExternal', tab.url))}
          >
            <ArrowUpRight size={14} />
          </Button>
        )}
      </form>
      {(error || listError || tab?.crashed || (tab && (tab.released || controllerText(tab.controller)))) && (
        <p
          className="m-0 px-3 py-1 text-caption text-muted-foreground"
          role={error || listError || tab?.crashed ? 'alert' : 'status'}
        >
          {error ??
            listError ??
            (tab?.paused
              ? t('Control disconnected. Take control to continue.')
              : tab?.released
                ? t('Handed back. The agent takes over on its next run.')
                : tab?.crashed
                  ? t('This page stopped working. Reload it.')
                  : tab?.controller === 'human' && !tab.inputReady
                    ? t('Waiting for the current browser action to finish')
                    : tab
                      ? controllerText(tab.controller)
                      : '')}
        </p>
      )}

      <div ref={area} className="min-h-0 flex-1" aria-label={t('Page')}>
        {tab && covered && (
          <p className="m-0 p-6 text-center text-muted-foreground">{t('The page returns when this dialog closes.')}</p>
        )}
        {!tab && (
          <p className="m-0 p-6 text-center text-muted-foreground">
            {listed ? t('Choose a tab or enter an address to open a page.') : t('Loading…')}
          </p>
        )}
      </div>
    </div>
  )
}
