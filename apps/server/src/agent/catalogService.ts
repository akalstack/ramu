import { classifyLegacyCatalog } from '../providers/modelLifecycle'
import { applyModelSignals, type ModelSignals } from '../providers/modelSignals'
import { providerAccountId } from '../providers/providerBinaries'
import { acpModels } from '../providers/acp'
import { launchCompatibility } from '../providers/launchCompatibility'
import { providerName, providerEnabled } from '@ramu/shared/providers/providers'
import type { AppPreferences, AgentSettings, AgentProvider, ProviderCatalog } from '@ramu/shared/types'
import { codexModels } from '../providers/codex'
import type { QueryFn } from './types'
import { fakeCatalogs, discoverCatalogs } from './catalog'
import type { ContextUsageTracker } from './contextUsage'

/** No signals: one shared empty set, so an unchanged catalog keeps its classified result. */
const EMPTY: ModelSignals = {}

/** What CatalogService needs from the rest of the service. */
export interface CatalogServiceHost extends Partial<
  Pick<ContextUsageTracker, 'rememberModelContext' | 'modelContextWindow'>
> {
  catalog(refresh?: boolean): Promise<ProviderCatalog[]>
  preferences(): AppPreferences | undefined
  providerQuery: QueryFn
  /** Release and retirement dates from public catalogs, when the host may read them. */
  modelSignals?(): ModelSignals
}

/** Model catalog discovery (cached) and validation of a chat's settings against it. */
export class CatalogService {
  constructor(private readonly host: CatalogServiceHost) {}

  private catalogs: Promise<ProviderCatalog[]> | null = null
  private classified: { raw: ProviderCatalog[]; signals: ModelSignals; result: ProviderCatalog[] } | null = null

  providerOff(provider: AgentProvider): boolean {
    return !providerEnabled(this.host.preferences()?.providerBinaries, provider)
  }

  discoverCatalog(refresh: boolean): Promise<ProviderCatalog[]> {
    if (refresh) this.catalogs = null
    // Signals apply on read, so a fresh download shows up without asking each provider again; the result is reused
    // until the catalog or the signals change.
    const classify = (catalogs: ProviderCatalog[]) => {
      const signals = this.host.modelSignals?.() ?? EMPTY
      if (this.classified?.raw !== catalogs || this.classified.signals !== signals)
        this.classified = {
          raw: catalogs,
          signals,
          result: catalogs.map((catalog) => classifyLegacyCatalog(applyModelSignals(catalog, signals))),
        }
      return this.classified.result
    }
    if (process.env.RAMU_FAKE_AGENT === '1') return Promise.resolve(classify(fakeCatalogs()))
    this.catalogs ??= discoverCatalogs({
      providerOff: (provider) => this.providerOff(provider),
      providerQuery: (args) => this.host.providerQuery(args),
    })
    return this.catalogs.then(classify)
  }

  invalidateCatalog() {
    this.catalogs = null
  }

  /**
   * Whether these settings may start a process at all: the provider and its login are turned on, and the installed
   * runtime is one Ramu can launch. A thread resuming on its recorded model checks only this, since its model may have
   * left today's catalog.
   */
  async validateLaunch(settings: AgentSettings): Promise<void> {
    if (this.providerOff(settings.provider))
      throw new Error(`${providerName(settings.provider)} is turned off in Settings → Providers.`)
    const account =
      settings.accountId && settings.accountId !== 'default'
        ? this.host
            .preferences()
            ?.providerBinaries[settings.provider]?.accounts?.find((entry) => entry.id === settings.accountId)
        : undefined
    const prefs = this.host.preferences()?.providerBinaries[settings.provider]
    if ((!settings.accountId || settings.accountId === 'default') && prefs?.defaultAccountEnabled === false)
      throw new Error(`The default ${providerName(settings.provider)} login is turned off in Settings → Providers.`)
    if (account?.enabled === false)
      throw new Error(
        `The ${providerName(settings.provider)} account "${account.name || account.id}" is turned off in Settings → Providers.`,
      )
    // One decision at every new process boundary: main threads, helpers, advisors, background work and fallback targets.
    if (launchCompatibility.applies(settings.provider) && process.env.RAMU_FAKE_AGENT !== '1')
      await launchCompatibility.assertLaunchable(settings.provider)
  }

  /** `validateLaunch`, and the model, effort and service tier exist in the provider's catalog. */
  async validateSettings(settings: AgentSettings): Promise<void> {
    await this.validateLaunch(settings)
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
    if (model.contextWindow)
      this.host.rememberModelContext?.(
        settings,
        Math.min(model.contextWindow, this.host.modelContextWindow?.(settings) ?? Infinity),
      )
  }
}
