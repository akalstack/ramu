import type { ProviderConfiguration } from '@ramu/shared/providers/providers'
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
