import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Hand, RotateCw, X } from 'lucide-react'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import type { ViewDescriptor } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { t, useLanguage } from '../i18n'
import { ramu } from '../ipc'
import { errorText } from '../lib/errors'
import { addressFrom } from './browserAddress'
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
  const [tab, setTab] = useState<BrowserTabInfo | null>(null)
  const [address, setAddress] = useState(view.url ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const area = useRef<HTMLDivElement>(null)
  const tabId = tab?.id

  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    setError(null)
    setBusy(true)
    try {
      return await work()
    } catch (reason) {
      setError(errorText(reason))
      return undefined
    } finally {
      setBusy(false)
    }
  }, [])

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
      const opened = await run(() => ramu.invoke('browser.open', host, taskId, url))
      if (opened) {
        setTab(opened.tab)
        setAddress(opened.tab.url)
      }
    },
    [host, taskId, tabId, run],
  )

  // A restored view reopens its last address once it is shown; nothing loads while the pane is hidden.
  const reopened = useRef(false)
  useEffect(() => {
    if (!visible || reopened.current || tab || !view.url) return
    reopened.current = true
    void open(view.url)
  }, [visible, tab, view.url, open])

  // Place the native page over the pane while it is visible; take it off screen when it is not.
  useEffect(() => {
    if (!tabId) return
    const element = area.current
    if (!visible || !element) {
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
  }, [visible, tabId, host, taskId])

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

  return (
    <div className="browser-view flex min-h-0 min-w-0 flex-1 flex-col">
      <form
        className="flex flex-none items-center gap-1 border-b border-(--line) px-2 py-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          void open(address)
        }}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('Back')}
          disabled={!tabId || busy}
          onClick={() => call('browser.back')}
        >
          <ArrowLeft size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('Forward')}
          disabled={!tabId || busy}
          onClick={() => call('browser.forward')}
        >
          <ArrowRight size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('Reload')}
          disabled={!tabId || busy}
          onClick={() => call('browser.reload')}
        >
          <RotateCw size={14} />
        </Button>
        <Input
          aria-label={t('Web address')}
          placeholder={t('Search or enter a web address')}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          className="min-w-0 flex-1"
        />
        {tab && tab.controller !== 'human' && (
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void take()}>
            <Hand size={14} />
            {t('Take control')}
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
      {(error || tab?.crashed || (tab && controllerText(tab.controller))) && (
        <p
          className="m-0 px-3 py-1 text-caption text-muted-foreground"
          role={error || tab?.crashed ? 'alert' : 'status'}
        >
          {error ??
            (tab?.crashed ? t('This page stopped working. Reload it.') : tab ? controllerText(tab.controller) : '')}
        </p>
      )}
      <div ref={area} className="min-h-0 flex-1" aria-label={t('Page')}>
        {!tab && (
          <p className="m-0 p-6 text-center text-muted-foreground">
            {t('Enter an address to open a page. It opens in a profile of its own, separate from your threads.')}
          </p>
        )}
      </div>
    </div>
  )
}
