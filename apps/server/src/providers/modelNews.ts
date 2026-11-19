// New models as a person meets them: the host remembers which models each provider offers, tells every device once when
// a provider it already knew starts offering another, and tags such a model as New for two weeks when no public release
// date says otherwise.
import type { AgentModel, ModelNotice, ProviderCatalog } from '@ramu/shared/types'

const SEEN_KEY = 'models:first-seen:v1'
const NEWS_KEY = 'models:news:v1'
/** When each model was announced: only these, not the ones learned quietly, can read as New from a sighting. */
const ANNOUNCED_KEY = 'models:announced:v1'
/** Notices kept until dismissed; the oldest go first past this many. */
const MAX_NOTICES = 20
/** How long a model first seen here, with no public release date, reads as New. */
const NEW_FOR_MS = 14 * 24 * 60 * 60_000

const keyOf = (provider: string, model: string) => `${provider}:${model}`

type State = {
  get<T>(key: string, fallback: T): T
  set(key: string, value: unknown): void
}

export class ModelNews {
  constructor(
    private readonly state: State,
    /** Settings → Models: tell me about new models. */
    private readonly enabled: () => boolean,
    /** Every device reads the notices again. */
    private readonly changed: (notices: ModelNotice[]) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Records the models a catalog read offers. A provider seen for the first time is learned quietly, so turning one on
   * or the host's first run does not announce every model it has.
   */
  observe(catalogs: readonly ProviderCatalog[]): void {
    const seen = { ...this.state.get<Record<string, number>>(SEEN_KEY, {}) }
    const known = new Set(Object.keys(seen).map((key) => key.slice(0, key.indexOf(':'))))
    const at = this.now()
    const added: ModelNotice[] = []
    for (const catalog of catalogs)
      for (const model of catalog.models) {
        const key = keyOf(catalog.provider, model.id)
        if (key in seen) continue
        seen[key] = at
        if (known.has(catalog.provider) && !model.isLegacy)
          added.push({ provider: catalog.provider, model: model.id, name: model.name, at })
      }
    if (Object.keys(seen).length !== Object.keys(this.state.get(SEEN_KEY, {})).length) this.state.set(SEEN_KEY, seen)
    if (!added.length) return
    this.state.set(ANNOUNCED_KEY, {
      ...this.state.get<Record<string, number>>(ANNOUNCED_KEY, {}),
      ...Object.fromEntries(added.map((notice) => [keyOf(notice.provider, notice.model), notice.at])),
    })
    if (!this.enabled()) return
    const notices = [...this.notices(), ...added].slice(-MAX_NOTICES)
    this.state.set(NEWS_KEY, notices)
    this.changed(notices)
  }

  /** New models no device has dismissed yet. Empty while the setting is off. */
  notices(): ModelNotice[] {
    return this.enabled() ? this.state.get<ModelNotice[]>(NEWS_KEY, []) : []
  }

  /** Dismissed on one device, gone on all of them. */
  dismiss(provider: string, model: string): void {
    const notices = this.state
      .get<ModelNotice[]>(NEWS_KEY, [])
      .filter((notice) => notice.provider !== provider || notice.model !== model)
    this.state.set(NEWS_KEY, notices)
    this.changed(this.notices())
  }

  /** A model with no public release date reads as New for two weeks after it appeared beside the ones already known. */
  tag(catalog: ProviderCatalog): ProviderCatalog {
    const seen = this.state.get<Record<string, number>>(ANNOUNCED_KEY, {})
    const now = this.now()
    return {
      ...catalog,
      models: catalog.models.map((model): AgentModel => {
        const first = seen[keyOf(catalog.provider, model.id)]
        return model.releasedAt || first === undefined || now - first > NEW_FOR_MS
          ? model
          : { ...model, releasedAt: new Date(first).toISOString().slice(0, 10) }
      }),
    }
  }
}
