// Where a host group in the sidebar gets its rows. Framework-free so the rule can be tested without React.
import type { HostOverview } from '@ramu/shared/hostOverview'
import type { Project, Task } from '@ramu/shared/types'

export interface HostRows {
  /**
   * `store`: the host's own workspace store in this window, live from its events. `overview`: the polled snapshot,
   * only while the store is not loaded (it is mounting, or the host is not connected and shows its last known rows).
   */
  source: 'store' | 'overview'
  tasks: Task[]
  projects: Project[]
  loading: boolean
  failed: boolean
  /** Whether anything is known about the host's threads yet. */
  known: boolean
}

export function hostRows({
  store,
  overview,
}: {
  store: { tasks: Task[]; projects: Project[] } | null
  overview?: { data?: HostOverview; isLoading: boolean; error: unknown }
}): HostRows {
  if (store)
    return { source: 'store', tasks: store.tasks, projects: store.projects, loading: false, failed: false, known: true }
  const data = overview?.data
  return {
    source: 'overview',
    tasks: data?.tasks ?? [],
    projects: data?.projects ?? [],
    loading: !!overview?.isLoading,
    failed: !!overview?.error || !!data?.errors.length,
    known: !!data,
  }
}
