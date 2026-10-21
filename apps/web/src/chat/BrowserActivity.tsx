import { useEffect, useState } from 'react'
import { Globe } from 'lucide-react'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import { ramu } from '../ipc'
import { ownHostId } from '../hosts'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'
import { useWorkspace } from '../workspace/workspace'
import { ChatActivityButton } from './ChatActivity'

/** Native tabs remain discoverable after an agent turn, without activating background threads or hosts. */
export function useBrowserActivity(taskId: string | undefined, visible: boolean) {
  const { id: host } = useHost()
  const scope = `${host}:${taskId ?? ''}`
  const [reading, setReading] = useState<{ scope: string; tabs: BrowserTabInfo[]; stale: boolean }>({
    scope,
    tabs: [],
    stale: false,
  })
  useEffect(() => {
    if (!taskId || !visible || host !== ownHostId()) return
    let active = true,
      revision = 0
    const load = async () => {
      const mine = ++revision
      try {
        const tabs = await ramu.invoke('browser.list', host, taskId)
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
    return () => {
      active = false
      off()
    }
  }, [scope, host, taskId, visible])
  return {
    taskId,
    tabs: host === ownHostId() && reading.scope === scope ? reading.tabs : [],
    stale: reading.scope !== scope || reading.stale,
  }
}

export function BrowserActivity({ state }: { state: ReturnType<typeof useBrowserActivity> }) {
  useLanguage()
  const ws = useWorkspace()
  if (!state.taskId || !state.tabs.length) return null
  const taskId = state.taskId
  return (
    <ChatActivityButton
      type="button"
      disabled={state.stale}
      onClick={() => {
        const first = state.tabs[0]!
        const view = ws.taskUi[ws.workspaceOf(taskId)]?.views.find(
          (view) => view.kind === 'browser' && view.tabId === first.id,
        )
        if (view) ws.activateView(taskId, view.id)
        else ws.openView(taskId, { kind: 'browser', tabId: first.id, url: first.url })
      }}
    >
      <Globe size={14} aria-hidden="true" />
      {t('{0} browser tabs', { 0: state.tabs.length })}
      <span className="text-muted-foreground">
        {' '}
        ·{' '}
        {t(
          state.stale
            ? 'Last-known activity'
            : state.tabs.some((tab) => tab.controller === 'agent')
              ? 'Agent control'
              : 'Open browser',
        )}
      </span>
    </ChatActivityButton>
  )
}
