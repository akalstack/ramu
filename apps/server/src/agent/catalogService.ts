import { providerAccountId } from '../providers/providerBinaries'
import { acpModels } from '../providers/acp'
import { providerName, providerEnabled } from '@ramu/shared/providers'
import type { AppPreferences, AgentSettings, AgentProvider, ProviderCatalog } from '@ramu/shared/types'
import { codexModels } from '../providers/codex'
import type { QueryFn } from './types'
import { fakeCatalogs, discoverCatalogs } from './catalog'

/** What CatalogService needs from the rest of the service. */
export interface CatalogServiceHost {
  catalog(refresh?: boolean): Promise<ProviderCatalog[]>
  preferences(): AppPreferences | undefined
  providerQuery: QueryFn
}

/** Model catalog discovery (cached) and validation of a chat's settings against it. */
export class CatalogService {
  constructor(private readonly host: CatalogServiceHost) {}

  private catalogs: Promise<ProviderCatalog[]> | null = null

  providerOff(provider: AgentProvider): boolean {
    return !providerEnabled(this.host.preferences()?.providerBinaries, provider)
  }

  discoverCatalog(refresh: boolean): Promise<ProviderCatalog[]> {
    if (refresh) this.catalogs = null
    if (process.env.RAMU_FAKE_AGENT === '1') return Promise.resolve(fakeCatalogs())
    this.catalogs ??= discoverCatalogs({
      providerOff: (provider) => this.providerOff(provider),
      providerQuery: (args) => this.host.providerQuery(args),
    })
    return this.catalogs
  }

  invalidateCatalog() {
    this.catalogs = null
  }

  async validateSettings(settings: AgentSettings): Promise<void> {
    if (this.providerOff(settings.provider))
      throw new Error(`${providerName(settings.provider)} is turned off in Settings → Providers.`)
    const account =
      settings.accountId && settings.accountId !== 'default'
        ? this.host
            .preferences()
            ?.providerBinaries[settings.provider]?.accounts?.find((entry) => entry.id === settings.accountId)
        : undefined
    if (account?.enabled === false)
      throw new Error(
        `The ${providerName(settings.provider)} account "${account.name}" is turned off in Settings → Providers.`,
      )
    let catalog = (await this.host.catalog()).find((c) => c.provider === settings.provider)
    // A retained chat may belong to a different profile than today's default.
    if (
      process.env.RAMU_FAKE_AGENT !== '1' &&
      settings.accountId &&
      settings.accountId !== providerAccountId(settings.provider) &&
      (settings.provider === 'codex' || settings.provider === 'opencode')
    ) {
      const models =
        settings.provider === 'codex'
          ? await codexModels(settings.accountId)
          : await acpModels('opencode', settings.accountId)
      catalog = { provider: settings.provider, models }
    }
    const model = settings.model
      ? catalog?.models.find((m) => m.id === settings.model)
      : (catalog?.models.find((m) => m.isDefault) ?? catalog?.models[0])
    if (!model) throw new Error(catalog?.error || 'This model is not available')
    if (
      settings.provider === 'codex' &&
      settings.serviceTier === 'fast' &&
      !model.serviceTiers?.some((tier) => tier === 'fast' || tier === 'priority')
    )
      throw new Error('Fast mode is not available for this Codex model.')
    if (settings.effort && !model.efforts.includes(settings.effort))
      throw new Error('This model does not support that reasoning effort')
  }
}
