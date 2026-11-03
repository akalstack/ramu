import { RowButton } from '@/components/row-button'
import { useEffect, useState } from 'react'
import { Globe, PictureInPicture2, Plus } from 'lucide-react'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import { ramu } from '../ipc'
import { ownHostId } from '../hosts'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'
import { useWorkspace, useHostRuntime } from '../workspace/workspace'
import { Button } from '@/components/desktop-button'
import { openBrowser } from '../views/browserPane'
import { ComposerTraySection } from '../composer/ComposerTraySection'
import { floatLiveView } from '../liveView/liveViewStore'
import { useAppSettings } from '../settings/AppSettings'

/** Native tabs remain discoverable after an agent turn, without activating background threads or hosts. */
export function useBrowserActivity(taskId: string | undefined, visible: boolean) {
  const { id: host, invoke } = useHost()
  const events = useHostRuntime()
  const scope = `${host}:${taskId ?? ''}`
  const [reading, setReading] = useState<{ scope: string; tabs: BrowserTabInfo[]; stale: boolean }>({
    scope,
    tabs: [],
    stale: false,
  })
  useEffect(() => {
    if (!taskId || !visible) return
    let active = true,
      revision = 0
    const load = async () => {
      const mine = ++revision
      try {
        const status = await invoke('hostBrowser.status').catch(() => null)
        const tabs = status?.enabled
          ? (await invoke('hostBrowser.list', taskId)).map((tab) => ({ ...tab, hostId: host }))
          : host === ownHostId()
            ? await ramu.invoke('browser.list', host, taskId)
            : []
        if (active && mine === revision) setReading({ scope, tabs, stale: false })
      } catch {
        if (active && mine === revision)
          setReading((previous) =>
            previous.scope === scope ? { ...previous, stale: true } : { scope, tabs: [], stale: true },
          )
      }
    }
    void load()
    const off = ramu.on('browser:changed', () => {
      void load()
    })
    const offHost = events.on('hostBrowser:changed', () => void load())
    return () => {
      active = false
      off()
      offHost()
    }
  }, [scope, host, taskId, visible, invoke, events])
  return {
    taskId,
    tabs: reading.scope === scope ? reading.tabs : [],
    stale: reading.scope !== scope || reading.stale,
  }
}

/** Shows a tab in the thread's browser pane, reusing the pane that already holds it. */
export const showBrowserTab = openBrowser

const controllerLabel = (tab: BrowserTabInfo) =>
  tab.paused
    ? 'Control disconnected'
    : tab.controller === 'agent'
      ? 'Agent control'
      : tab.controller === 'human'
        ? 'You are in control'
        : 'Open browser'

export function BrowserActivity({ state }: { state: ReturnType<typeof useBrowserActivity> }) {
  useLanguage()
  const ws = useWorkspace()
  const { id: host } = useHost()
  const liveView = useAppSettings().preferences.liveViewDesktop
  if (!state.taskId || !state.tabs.length) return null
  const taskId = state.taskId
  return (
    <ComposerTraySection
      aria-label={t('Browser')}
      title={t('Browser')}
      count={state.tabs.length}
      icon={<Globe />}
      actions={
        state.stale ? (
          <span className="text-muted-foreground text-caption">{t('Last-known activity')}</span>
        ) : (
          <>
            {liveView && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="icon small-icon"
                aria-label={t('Float')}
                title={t('Float: keep a live view in the corner')}
                onClick={() => floatLiveView(host, taskId)}
              >
                <PictureInPicture2 size={14} />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              className="icon small-icon"
              aria-label={t('New browser tab')}
              title={t('New browser tab')}
              onClick={() => openBrowser(ws, taskId, 'new')}
            >
              <Plus size={14} />
            </Button>
          </>
        )
      }
    >
      <ul className="m-0 flex max-h-40 list-none flex-col overflow-y-auto overscroll-contain p-0">
        {state.tabs.map((tab) => (
          <li key={tab.id} className="flex items-center gap-2 text-control">
            <RowButton
              size="sm"
              stacked
              className="w-auto flex-1 min-w-0 -ml-2 px-2 py-1"
              disabled={state.stale}
              title={t('Open browser')}
              onClick={() => showBrowserTab(ws, taskId, tab)}
            >
              <span className="w-full truncate text-foreground">{tab.title || tab.url}</span>
              <span className="w-full truncate text-caption text-muted-foreground">
                {t(controllerLabel(tab))} · {tab.url}
              </span>
            </RowButton>
          </li>
        ))}
      </ul>
    </ComposerTraySection>
  )
}
