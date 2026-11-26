import { ownHostId } from '../../hosts'
import { useHost } from '../../workspace/HostProvider'
import { useWorkspace, useWorkspaceOf } from '../../workspace/workspace'
import { sharedSectionKeys, sidebarTreeKey } from './threadLists'

/**
 * Open and closed rows of the sidebar tree. Always kept in the window's own store and keyed by the row's host, never by
 * which host is on screen, so switching hosts leaves the tree exactly as it was.
 */
export function useSidebarExpansion(hostId?: string) {
  const active = useWorkspace()
  const chrome = useWorkspaceOf(ownHostId()) ?? active
  const scoped = useHost()
  const host = hostId ?? scoped.id
  return {
    isExpanded: (key: string) => chrome.isExpanded(sidebarTreeKey(host, ownHostId(), key)),
    setExpanded: (key: string, expanded: boolean) =>
      chrome.setExpanded(sidebarTreeKey(host, ownHostId(), key), expanded),
  }
}

/**
 * A section that means the same thing whichever host is on screen (Done, Needs you): one open state in the window's own
 * store. Toggling it clears the keys that closed it under a host's namespace, leaving the shared key as the only record.
 */
export function useSharedSidebarSection(key: string) {
  const active = useWorkspace()
  const chrome = useWorkspaceOf(ownHostId()) ?? active
  const closedBy = sharedSectionKeys(chrome.ui.collapsed ?? [], key)
  return {
    open: closedBy.length === 0,
    setOpen: (open: boolean) => {
      for (const entry of closedBy) if (entry !== key) chrome.setExpanded(entry, true)
      chrome.setExpanded(key, open)
    },
  }
}
