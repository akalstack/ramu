import { queryClient } from '../dataQueries'
import { useQueries } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import type { HostOverview } from '@ramu/shared/hostOverview'
import type { Project, Task } from '@ramu/shared/types'
import { ramu } from '../ipc'
import { useComputers } from './computers'
import { storeForHost } from '../hostStorage'
import { onWorkspaceVisibility, workspaceVisible } from './workspaceLifetime'

// The main process coalesces host events, so token streaming never refetches an overview.
ramu.on('computers:activity', ({ ids }) => {
  for (const id of ids)
    void queryClient.invalidateQueries({ queryKey: ['host-overview', id] }, { cancelRefetch: false })
})

const overviewKey = (id: string) => ['host-overview', id] as const

/** Where a host's last overview is kept on this device, so an offline host still lists its threads after a restart. */
const LAST_KEY = 'last-overview'
/** Saves stay well inside the browser's storage quota; older threads past this many are left out. */
const MAX_SAVED_TASKS = 400

/** The host's overview as last saved here, or undefined. Its errors are not kept: they described that read. */
export function readLastOverview(id: string): HostOverview | undefined {
  try {
    const saved = JSON.parse(storeForHost(id)?.getItem(LAST_KEY) ?? 'null') as Partial<HostOverview> | null
    return saved && Array.isArray(saved.tasks) && Array.isArray(saved.projects)
      ? {
          tasks: saved.tasks,
          projects: saved.projects,
          agents: saved.agents ?? [],
          recaps: saved.recaps ?? [],
          summaries: saved.summaries ?? [],
          errors: [],
        }
      : undefined
  } catch {
    return undefined
  }
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** Coalesces a host's saves: overviews refresh every few seconds while it works, and only the latest matters. */
function saveLastOverview(id: string, overview: HostOverview) {
  clearTimeout(saveTimers.get(id))
  saveTimers.set(
    id,
    setTimeout(() => {
      saveTimers.delete(id)
      const tasks = [...overview.tasks].sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, MAX_SAVED_TASKS)
      const { resources: _resources, errors: _errors, ...kept } = overview
      try {
        storeForHost(id)?.setItem(LAST_KEY, JSON.stringify({ ...kept, tasks }))
      } catch {
        // Storage full or unavailable: the host still shows its last rows for the rest of this session.
      }
    }, 2000),
  )
}

queryClient.getQueryCache().subscribe((event) => {
  const [kind, id] = event.query.queryKey as [string, string]
  if (kind !== 'host-overview' || event.type !== 'updated' || typeof id !== 'string') return
  const data = event.query.state.data as HostOverview | undefined
  // A read that failed or was refused leaves the last good overview in place.
  if (data && !data.errors.length) saveLastOverview(id, data)
})

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
      // What this device last saw, so an offline host lists its threads; fetched again as soon as it connects.
      initialData: () => readLastOverview(id),
      initialDataUpdatedAt: 0,
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
