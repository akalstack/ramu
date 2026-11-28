import { keepReading, lastReading } from '../lib/lastReading'
import { RowButton } from '@/components/row-button'
import { useEffect, useState } from 'react'
import { Globe, PictureInPicture2, Plus, X } from 'lucide-react'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import { ramu } from '../ipc'
import { ownHostId } from '../hosts'
import { isDeviceTool } from '@ramu/shared/chat/deviceTools'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'
import { useWorkspace, useHostRuntime } from '../workspace/workspace'
import { Button } from '@/components/desktop-button'
import { openBrowser } from '../views/browserPane'
import { ComposerTraySection, TRAY_LIST_CLASS } from '../composer/ComposerTraySection'
import { floatLiveView } from '../liveView/liveViewStore'
import { useAppSettings } from '../settings/AppSettings'

/**
 * The thread's browser tabs: the host browser's while it is on, otherwise this desktop's own browser for its own host.
 * One or the other, never both, so a tab is listed once.
 */
export async function readThreadTabs(
  invoke: ReturnType<typeof useHost>['invoke'],
  host: string,
  taskId: string,
): Promise<{ tabs: BrowserTabInfo[]; hostBrowser: boolean }> {
  const status = await invoke('hostBrowser.status').catch(() => null)
  // A host with its own browser reports an engine; a browserless one does not.
  if (status?.engine)
    return {
      tabs: (await invoke('hostBrowser.list', taskId)).map((tab) => ({ ...tab, hostId: host })),
      hostBrowser: true,
    }
  // Another host's agent uses that host's own desktop browser, which the host reports without a picture or control.
  return {
    tabs:
      host === ownHostId()
        ? await ramu.invoke('browser.list', host, taskId)
        : (await invoke('browser.activity', taskId)).tabs,
    hostBrowser: false,
  }
}

/** Native tabs remain discoverable after an agent turn, without activating background threads or hosts. */
export function useBrowserActivity(taskId: string | undefined, visible: boolean) {
  const { id: host, invoke } = useHost()
  const events = useHostRuntime()
  const scope = `${host}:${taskId ?? ''}`
  const [reading, setReading] = useState<{
    scope: string
    tabs: BrowserTabInfo[]
    stale: boolean
    hostBrowser?: boolean
  }>({
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
        const { tabs, hostBrowser } = await readThreadTabs(invoke, host, taskId)
        if (!active || mine !== revision) return
        keepReading('browser', scope, tabs)
        setReading({ scope, tabs, stale: false, hostBrowser })
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
    // Another host's desktop announces its browser only to itself; the agent's browser calls say when it changed.
    const calls = new Set<string>()
    const offCalls = events.on('agent:event', ({ event }) => {
      if (event.kind === 'tool-use' && isDeviceTool(event.name)) {
        calls.add(event.toolUseId)
        void load()
      } else if (event.kind === 'tool-result' && calls.delete(event.toolUseId)) void load()
    })
    return () => {
      active = false
      off()
      offHost()
      offCalls()
    }
  }, [scope, host, taskId, visible, invoke, events])
  const fresh = reading.scope === scope
  return {
    taskId,
    tabs: fresh ? reading.tabs : (lastReading<BrowserTabInfo[]>('browser', scope) ?? []),
    stale: !fresh || reading.stale,
    /** Closes one tab where it lives: the host's browser while it is on, otherwise this desktop's own. */
    close(tab: BrowserTabInfo): void {
      if (!taskId) return
      void (
        fresh && reading.hostBrowser
          ? invoke('hostBrowser.close', taskId, tab.id)
          : ramu.invoke('browser.close', host, taskId, tab.id)
      ).catch(() => {})
    },
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
      live={!state.stale && state.tabs.some((tab) => tab.controller === 'agent')}
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
      <ul className={TRAY_LIST_CLASS}>
        {state.tabs.map((tab) => (
          <li key={tab.id} className="flex items-center gap-2 text-control">
            <RowButton
              size="sm"
              stacked
              className="w-auto flex-1 min-w-0 px-1.5 py-1"
              disabled={state.stale}
              title={t('Open browser')}
              onClick={() => showBrowserTab(ws, taskId, tab)}
            >
              <span className="w-full truncate text-foreground">{tab.title || tab.url}</span>
              <span className="w-full truncate text-caption text-muted-foreground">
                {t(controllerLabel(tab))} · {tab.url}
              </span>
            </RowButton>
            <Button
              variant="ghost"
              size="icon-xs"
              className="icon small-icon shrink-0"
              aria-label={t('Close tab')}
              title={t('Close tab')}
              disabled={state.stale}
              onClick={() => state.close(tab)}
            >
              <X size={14} />
            </Button>
          </li>
        ))}
      </ul>
    </ComposerTraySection>
  )
}
