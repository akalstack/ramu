import { migrateModelDefaults, recommendedSets } from '@ramu/shared/providers/modelDefaults'
import type { ModelPreferences, ProviderCatalog } from '@ramu/shared/types'

/** What a host last reported for its model sets and provider catalogs. */
export interface ModelSetsSnapshot {
  preferences: ModelPreferences
  catalogs: ProviderCatalog[]
}

const cache = new Map<string, ModelSetsSnapshot>()

export const cachedModelSets = (host: string): ModelSetsSnapshot | undefined => cache.get(host)
export const rememberModelSets = (host: string, snapshot: ModelSetsSnapshot) => void cache.set(host, snapshot)

/**
 * Fetches a host's model sets and catalogs ahead of the shell that needs them, so putting that host on screen does not
 * wait for two round trips. A host that answers nothing leaves the cache empty and the provider loads for itself.
 */
export async function warmModelSets(
  host: string,
  invoke: (method: 'settings.models.get' | 'agent.catalog') => Promise<unknown>,
): Promise<void> {
  if (cache.has(host)) return
  const [saved, available] = await Promise.allSettled([invoke('settings.models.get'), invoke('agent.catalog')])
  if (saved.status === 'rejected' && available.status === 'rejected') return
  const catalogs = available.status === 'fulfilled' ? (available.value as ProviderCatalog[]) : []
  const defaults = recommendedSets(catalogs)
  const value = saved.status === 'fulfilled' && saved.value ? (saved.value as ModelPreferences) : defaults
  if (!cache.has(host)) cache.set(host, { preferences: migrateModelDefaults(value, defaults), catalogs })
}
