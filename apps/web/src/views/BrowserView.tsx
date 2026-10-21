import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, Hand, RotateCw, X } from 'lucide-react'
import type { BrowserDialog } from '@ramu/shared/browserBridge'
import type { BrowserProfileCatalog, BrowserTabInfo } from '@ramu/shared/types/browser'
import type { ViewDescriptor } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { t, useLanguage } from '../i18n'
import { ramu } from '../ipc'
import { Dialog as ConfirmDialog, Dropdown } from '../Menu'
import { errorText } from '../lib/errors'
import { addressFrom } from './browserAddress'
import { openOverlays, paneCovered } from './browserOverlay'
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
export function BrowserView({
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
  const [profile, setProfile] = useState(view.profileId ?? 'default')
  const [profiles, setProfiles] = useState<BrowserProfileCatalog | null>(null)
  const [websiteDialog, setWebsiteDialog] = useState<BrowserDialog | null>(null)
  const dialogRef = useRef(websiteDialog)
  dialogRef.current = websiteDialog
  const [dialogText, setDialogText] = useState('')
  const [dialogBusy, setDialogBusy] = useState(false)
  const [changingProfile, setChangingProfile] = useState<{ tabId: string; profileId: string; scope: string } | null>(
    null,
  )
  const [tab, setTab] = useState<BrowserTabInfo | null>(null)
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
      const url = addressFrom(raw)
      if (!url) return setError(t('Enter a web address.'))
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
        setProfile(opened.tab.profileId)
        if (opened.profileFellBack)
          setError(t('The selected profile is no longer available. This tab opened in Default.'))
      }
    },
    [host, taskId, tabId, run, profile],
  )

  // Read native ownership/navigation changes. Fence late reads when this pane changes host or thread.
  useEffect(() => {
    if (!visible) return
    let active = true,
      revision = 0
    const refresh = async () => {
      const mine = ++revision
      try {
        const [tabResult, profileResult] = await Promise.allSettled([
          ramu.invoke('browser.list', host, taskId),
          ramu.invoke('browser.profiles.list', host),
        ])
        if (!active || mine !== revision) return
        if (tabResult.status === 'rejected') throw tabResult.reason
        const tabs = tabResult.value
        setProfiles(profileResult.status === 'fulfilled' ? profileResult.value : null)
        setThreadTabs(tabs)
        setListError(null)
        const current =
          tabs.find((candidate) => candidate.id === tabId) ??
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
          reopened.current = true
          if (!editingAddress.current) setAddress(current.url)
        }
      } catch (reason) {
        if (active && mine === revision) setListError(t(errorText(reason)))
      }
    }
    const off = ramu.on('browser:changed', () => {
      void refresh()
    })
    void refresh()
    return () => {
      active = false
      off()
    }
  }, [host, taskId, tabId, visible, view.tabId, view.url])

  // An agent-created pane adopts the actual native tab instead of opening a duplicate page.
  const [adopted, setAdopted] = useState(!view.tabId)
  useEffect(() => {
    if (!view.tabId || !visible) return
    let active = true
    void ramu
      .invoke('browser.list', host, taskId)
      .then((tabs) => {
        if (!active) return
        const existing = tabs.find((candidate) => candidate.id === view.tabId)
        if (existing) {
          reopened.current = true
          setTab(existing)
          setAddress(existing.url)
        }
        setAdopted(true)
      })
      .catch((reason) => {
        if (active) setError(t(errorText(reason)))
      })
    return () => {
      active = false
    }
  }, [view.tabId, visible, host, taskId])

  // A restored view reopens its last address once it is shown; nothing loads while the pane is hidden.
  const reopened = useRef(false)
  useEffect(() => {
    setTab(null)
    setThreadTabs([])
    setProfile(view.profileId ?? 'default')
    setProfiles(null)
    setChangingProfile(null)
    setWebsiteDialog(null)
    setDialogBusy(false)
    setListError(null)
    startingNew.current = false
    setAddress(view.url ?? '')
    setError(null)
    setBusy(false)
    setAdopted(!view.tabId)
    reopened.current = false
  }, [scope])
  useEffect(() => {
    if (!visible || !adopted || reopened.current || tab || !view.url) return
    reopened.current = true
    void open(view.url)
  }, [visible, adopted, tab, view.url, open])

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
  const closeTab = async () => {
    if (tabId) await run(() => ramu.invoke('browser.close', host, taskId, tabId))
    ws.closeView(taskId, view.id)
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

  const profileOptions = (
    profiles?.profiles ?? [
      { id: 'default', name: 'Default', builtin: true },
      { id: 'temporary', name: 'Temporary', builtin: true },
    ]
  ).map((entry) => ({ value: entry.id, label: entry.builtin ? t(entry.name) : entry.name }))
  const selectedProfile = tab?.profileId ?? profile
  if (!profileOptions.some((entry) => entry.value === selectedProfile))
    profileOptions.push({ value: selectedProfile, label: t('Unavailable profile ({0})', { 0: selectedProfile }) })

  return (
    <div ref={pane} className="browser-view flex min-h-0 min-w-0 flex-1 flex-col">
      {threadTabs.length > 0 && (
        <div className="flex flex-none items-center gap-2 border-b border-(--line) px-2 py-1 text-caption text-muted-foreground">
          <Dropdown
            label={t('Browser tabs')}
            value={tabId ?? 'new'}
            disabled={busy}
            options={[
              ...threadTabs.map((entry) => ({ value: entry.id, label: (entry.title || entry.url).slice(0, 120) })),
              { value: 'new', label: t('New browser tab') },
            ]}
            onChange={(id) => {
              const chosen = threadTabs.find((entry) => entry.id === id)
              startingNew.current = !chosen
              reopened.current = true
              setTab(chosen ?? null)
              setAddress(chosen?.url ?? '')
              setError(null)
            }}
          />
          <span>
            {tab?.profileId === 'temporary' ? t('Temporary') : t('Shared profile')} · {t('This computer')}
          </span>
        </div>
      )}
      <div className="flex flex-none items-center gap-2 border-b border-(--line) px-2 py-1 text-caption text-muted-foreground">
        <Dropdown
          label={t('Browser profile')}
          value={selectedProfile}
          options={profileOptions}
          disabled={busy || (!!tab && !tab.inputReady) || !!profiles?.error}
          onChange={(id) => {
            if (!tab) setProfile(id)
            else if (id !== tab.profileId) setChangingProfile({ tabId: tab.id, profileId: id, scope })
          }}
        />
        <span>{t(selectedProfile === 'temporary' ? 'Separate for each run' : 'Shared profile')}</span>
      </div>
      {changingProfile && (
        <ConfirmDialog
          title={t('Change browser profile?')}
          confirmLabel={t('Open in selected profile')}
          busy={busy}
          onCancel={() => setChangingProfile(null)}
          onConfirm={() => {
            const intent = changingProfile
            setChangingProfile(null)
            if (intent.scope !== latestScope.current || intent.tabId !== tabId) return
            void run(() => ramu.invoke('browser.changeProfile', host, taskId, intent.tabId, intent.profileId)).then(
              (next) => {
                if (next) {
                  setTab(next)
                  setAddress(next.url)
                  setProfile(next.profileId)
                }
              },
            )
          }}
        >
          <p>
            {t(
              'This reloads the current address in a separate website identity. The old page closes only after the new page loads. Unsaved page input does not transfer.',
            )}
          </p>
        </ConfirmDialog>
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
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('Close tab')}
          onClick={() => void closeTab()}
        >
          <X size={14} />
        </Button>
      </form>
      {(error || listError || tab?.crashed || (tab && controllerText(tab.controller))) && (
        <p
          className="m-0 px-3 py-1 text-caption text-muted-foreground"
          role={error || listError || tab?.crashed ? 'alert' : 'status'}
        >
          {error ??
            listError ??
            (tab?.paused
              ? t('Control disconnected. Take control to continue.')
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
            {t('Enter an address to open a page. It opens in a profile of its own, separate from your threads.')}
          </p>
        )}
      </div>
    </div>
  )
}
