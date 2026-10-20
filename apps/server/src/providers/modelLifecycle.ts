import type { AgentModel, ProviderCatalog } from '@ramu/shared/types'

/** Preserve explicit lifecycle metadata when an adapter exposes it. Hidden is not a lifecycle status. */
export function modelLegacyMetadata(value: unknown): Pick<AgentModel, 'isLegacy'> {
  if (!value || typeof value !== 'object') return {}
  const model = value as Record<string, unknown>
  if (typeof model.isLegacy === 'boolean') return { isLegacy: model.isLegacy }
  if (model.status === 'current') return { isLegacy: false }
  if (
    model.deprecated === true ||
    model.isDeprecated === true ||
    model.status === 'legacy' ||
    model.status === 'deprecated'
  )
    return { isLegacy: true }
  return {}
}

/** Only compare recognized, versioned families. Aliases, variants and custom IDs stay provider-owned. */
function versionedFamily(model: AgentModel): { family: string; version: number[] } | undefined {
  if (model.provider === 'codex') {
    const match = /^gpt-(\d+(?:\.\d+)*?)-(sol|luna|astra|terra)$/.exec(model.id)
    if (match) return { family: match[2]!, version: match[1]!.split('.').map(Number) }
  }
  if (model.provider === 'claude-code') {
    const match = /^(?:claude-)?(sonnet|opus|haiku)-(\d+)(?:[.-](\d{1,2}))?(?:-\d{8})?$/.exec(model.id)
    if (match) return { family: match[1]!, version: [Number(match[2]), Number(match[3] ?? 0)] }
    const older = /^claude-(\d+)(?:-(\d{1,2}))?-(sonnet|opus|haiku)(?:-\d{8})?$/.exec(model.id)
    if (older) return { family: older[3]!, version: [Number(older[1]), Number(older[2] ?? 0)] }
  }
  return undefined
}

const newer = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0)
    if (difference) return difference > 0
  }
  return false
}

/** The execution host classifies models within each provider's actual catalog, without a dated model allowlist. */
export function classifyLegacyCatalog(catalog: ProviderCatalog): ProviderCatalog {
  const known = catalog.models.map((model) => ({ model, family: versionedFamily(model) }))
  return {
    ...catalog,
    models: known.map(({ model, family }) => {
      if (model.isLegacy !== undefined || !family || model.provider !== catalog.provider) return model
      const superseded = known.some(
        (other) =>
          other.model.provider === model.provider &&
          other.model.isLegacy !== true &&
          other.family?.family === family.family &&
          newer(other.family.version, family.version),
      )
      return superseded ? { ...model, isLegacy: true } : model
    }),
  }
}
