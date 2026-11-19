import { ownHostId } from '../../hosts'
import { useHost } from '../../workspace/HostProvider'
import { useWorkspace, useWorkspaceOf } from '../../workspace/workspace'
import { sidebarTreeKey } from './threadLists'

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
