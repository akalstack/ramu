// How an agent names a model for a helper (`opus-5.5`), and the short list it reads to choose one.
import type { AgentModel, AgentProvider, ProviderCatalog } from '../types'
import { modelHandle } from './helperMentions'

/** A current model before a legacy one with the same handle; a model id works too. */
export function findModelByHandle(models: readonly AgentModel[], handle: string): AgentModel | undefined {
  const wanted = handle.trim().replace(/^@/, '').toLowerCase()
  return (
    models.find((entry) => !entry.isLegacy && modelHandle(entry) === wanted) ??
    models.find((entry) => entry.id.toLowerCase() === wanted || modelHandle(entry) === wanted)
  )
}

export function modelHandles(models: readonly AgentModel[]): string[] {
  return models.filter((entry) => !entry.isLegacy).map((entry) => modelHandle(entry))
}

export interface AgentModelListing {
  provider: AgentProvider
  /** Why the provider cannot be used now, such as signed out. */
  unavailable?: string
  models: { handle: string; name: string; efforts: string[]; contextWindow?: number; default?: true }[]
  /** Models left out by the per-provider limit; a query narrows the list. */
  more: number
}

/**
 * What `agent_models` shows: each provider's current models, at most `perProvider` of them with its default first,
 * narrowed by a query on the name, handle or provider.
 */
export function agentModelList(catalogs: readonly ProviderCatalog[], query = '', perProvider = 8): AgentModelListing[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (model: AgentModel) => {
    const text = `${model.provider} ${model.name} ${model.id} ${modelHandle(model)}`.toLowerCase()
    return words.every((word) => text.includes(word))
  }
  return catalogs.flatMap((catalog) => {
    const models = catalog.models
      .filter((model) => !model.isLegacy && matches(model))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
    if (words.length && !models.length) return []
    return [
      {
        provider: catalog.provider,
        ...(catalog.error ? { unavailable: catalog.error } : {}),
        models: models.slice(0, perProvider).map((model) => ({
          handle: modelHandle(model),
          name: model.name || model.id,
          efforts: model.efforts,
          ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
          ...(model.isDefault ? { default: true as const } : {}),
        })),
        more: Math.max(0, models.length - perProvider),
      },
    ]
  })
}
