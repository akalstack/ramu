import { inboxTabOf, type InboxTab } from '@ramu/shared/hostInbox'
import type { WorkspaceApi } from '../workspace/workspace'

const TAB_KEY = 'ramu.inbox-tab'

export const savedInboxTab = (): InboxTab => inboxTabOf(localStorage.getItem(TAB_KEY))
export const saveInboxTab = (tab: InboxTab) => localStorage.setItem(TAB_KEY, tab)

/** Opens the Inbox page, on `tab` when given; an Inbox already on screen switches to it. */
export function openInbox(ws: Pick<WorkspaceApi, 'setSidebar'>, tab?: InboxTab) {
  if (tab) {
    saveInboxTab(tab)
    window.dispatchEvent(new CustomEvent('ramu:inbox-tab', { detail: tab }))
  }
  ws.setSidebar('inbox')
}
