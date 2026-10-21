import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import type { useWorkspace } from '../workspace/workspace'

type Workspace = Pick<ReturnType<typeof useWorkspace>, 'taskUi' | 'workspaceOf' | 'activateView' | 'openView'>

/** What a browser pane should show next: a tab of this thread, or a fresh one. Read once when the pane next looks. */
const wanted = new Map<string, string>()
export const NEW_TAB = 'new'
export const takeWantedTab = (viewId: string): string | undefined => {
  const tab = wanted.get(viewId)
  wanted.delete(viewId)
  return tab
}
const listeners = new Set<() => void>()
export const onWantedTab = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/**
 * The workspace has one Browser pane, shared by its chats like the terminal: each chat sees only its own tabs in it.
 * Opening a tab or a new page shows that pane and selects the tab, rather than adding another pane.
 */
export function openBrowser(ws: Workspace, taskId: string, tab?: BrowserTabInfo | typeof NEW_TAB) {
  const existing = ws.taskUi[ws.workspaceOf(taskId)]?.views.find((view) => view.kind === 'browser')
  if (!existing) {
    if (tab && tab !== NEW_TAB) ws.openView(taskId, { kind: 'browser', tabId: tab.id, url: tab.url })
    else ws.openView(taskId, { kind: 'browser' })
    return
  }
  if (tab) wanted.set(existing.id, tab === NEW_TAB ? NEW_TAB : tab.id)
  ws.activateView(taskId, existing.id)
  for (const listener of listeners) listener()
}

/** A deliberate agent handoff can reveal its page, but cannot take the person to another conversation. */
export function presentBrowser(
  ws: Workspace & { ui: { activeTaskId: string | null } },
  activeHost: string,
  tab: BrowserTabInfo,
): boolean {
  if (activeHost !== tab.hostId || ws.ui.activeTaskId !== tab.threadId) return false
  openBrowser(ws, tab.threadId, tab)
  return true
}
