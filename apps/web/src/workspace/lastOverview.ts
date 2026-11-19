// Free of the overview queries' side effects, so the offline copy can read it without loading them.
import type { HostOverview } from '@ramu/shared/hostOverview'
import { storeForHost } from '../hostStorage'

/** Where a host's last overview is kept on this device, so an offline host still lists its threads after a restart. */
export const LAST_OVERVIEW_KEY = 'last-overview'

/** The host's overview as last saved here, or undefined. Its errors are not kept: they described that read. */
export function readLastOverview(id: string): HostOverview | undefined {
  try {
    const saved = JSON.parse(storeForHost(id)?.getItem(LAST_OVERVIEW_KEY) ?? 'null') as Partial<HostOverview> | null
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
