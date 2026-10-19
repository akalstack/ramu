import { queryClient } from '../dataQueries'
import { useQueries } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import type { HostOverview } from '@ramu/shared/hostOverview'
import type { Project, Task } from '@ramu/shared/types'
import { ramu } from '../ipc'
import { useComputers } from './computers'
import { onWorkspaceVisibility, workspaceVisible } from './workspaceLifetime'

// The main process coalesces host events, so token streaming never refetches an overview.
ramu.on('computers:activity', ({ ids }) => {
  for (const id of ids)
    void queryClient.invalidateQueries({ queryKey: ['host-overview', id] }, { cancelRefetch: false })
})

const overviewKey = (id: string) => ['host-overview', id] as const

/**
 * Share reads between the sidebar and inbox. Hidden workspaces do not poll remote computers, and neither does a caller
 * for a host whose store it already shows (`live`): that store follows the host's events instead.
 */
export function useHostOverviews(ids: string[], live: (id: string) => boolean = () => false) {
  const state = useComputers()
  const visible = useSyncExternalStore(onWorkspaceVisibility, workspaceVisible)
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: overviewKey(id),
      queryFn: () => ramu.invoke('computers.overview', id),
      enabled: visible && !live(id) && !!state?.computers.some((c) => c.id === id && c.status === 'connected'),
      staleTime: 5000,
      refetchInterval: 15000,
    })),
  })
  return ids.map((id, i) => ({ id, ...queries[i]! }))
}

/**
 * Keeps a host's last known threads and projects in its cached overview while its store is shown, so the sidebar can
 * still show them ("Last known activity") once the host disconnects and its store goes away.
 */
export function rememberHostRows(id: string, rows: { tasks: Task[]; projects: Project[] }) {
  queryClient.setQueryData<HostOverview>(overviewKey(id), (previous) => ({
    agents: [],
    recaps: [],
    summaries: [],
    errors: [],
    ...previous,
    tasks: rows.tasks,
    projects: rows.projects,
  }))
}
