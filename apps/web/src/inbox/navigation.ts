import type { WorkspaceApi } from '../workspace/workspace'

export type InboxTab = 'all' | 'needs-you' | 'running' | 'recaps' | 'learned' | 'completed'
const TAB_KEY = 'ramu.inbox-tab'
const TABS: InboxTab[] = ['all', 'needs-you', 'running', 'recaps', 'learned', 'completed']

export const savedInboxTab = (): InboxTab => {
  const saved = localStorage.getItem(TAB_KEY) as InboxTab | null
  return saved && TABS.includes(saved) ? saved : 'all'
}
export const saveInboxTab = (tab: InboxTab) => localStorage.setItem(TAB_KEY, tab)

/** Opens the Inbox page, on `tab` when given; an Inbox already on screen switches to it. */
export function openInbox(ws: Pick<WorkspaceApi, 'setSidebar'>, tab?: InboxTab) {
  if (tab) {
    saveInboxTab(tab)
    window.dispatchEvent(new CustomEvent('ramu:inbox-tab', { detail: tab }))
  }
  ws.setSidebar('inbox')
}
