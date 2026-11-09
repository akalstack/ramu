import { AGENT_PROVIDERS, type ProviderConfiguration, type ProviderStatus } from '@ramu/shared/providers/providers'
import type { AgentProvider } from '@ramu/shared/types'
import type { RamuMethods } from '@ramu/shared/api'

/** Keep login details isolated by host and draft configuration. Explicit actions bypass both caches. */
export function providerStatusQuery(
  host: string,
  config: ProviderConfiguration,
  status: RamuMethods['providers.status'],
  latest = false,
  refresh = false,
) {
  return {
    queryKey: ['provider-settings', host, config] as const,
    queryFn: () => status(config, latest, refresh),
    staleTime: latest || refresh ? 0 : 60_000,
  }
}

/** The statuses Settings shows, and the request that produced each provider's, so an older answer never wins. */
export interface KnownStatuses {
  statuses: ProviderStatus[]
  stamps: Partial<Record<AgentProvider, number>>
}

export const NO_STATUSES: KnownStatuses = { statuses: [], stamps: {} }

/**
 * Takes in what a check returned (every provider, or one) without dropping the rest: a provider keeps its last result
 * until a newer request answers for it, so a re-check never blanks a row and a slow, older check cannot overwrite a
 * newer one. `stamp` grows with each request.
 */
export function applyStatuses(known: KnownStatuses, answer: ProviderStatus[], stamp: number): KnownStatuses {
  const fresh = answer.filter((status) => stamp > (known.stamps[status.provider] ?? -1))
  if (!fresh.length) return known
  const byProvider = new Map(known.statuses.map((status) => [status.provider, status]))
  for (const status of fresh) byProvider.set(status.provider, status)
  const stamps = { ...known.stamps }
  for (const status of fresh) stamps[status.provider] = stamp
  return { statuses: [...byProvider.values()], stamps }
}

/** The providers whose settings differ between two drafts, so only they are checked again. */
export function changedProviders(before: ProviderConfiguration, after: ProviderConfiguration): AgentProvider[] {
  return AGENT_PROVIDERS.filter((provider) => JSON.stringify(before[provider]) !== JSON.stringify(after[provider]))
}
