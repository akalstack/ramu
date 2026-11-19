import type { AgentProvider, ProviderCatalog } from '@ramu/shared/types'
import type { ProjectAgentDefaults } from '@ramu/shared/workspace/agentDefaults'
import type { ProjectConfigResult } from './projectConfig'

/** Resolve only provider/model identity from the host's real enabled catalog. No tools or inference. */
export async function projectAgentDefaults(
  configuration: ProjectConfigResult,
  defaultProvider: AgentProvider,
  catalog: () => Promise<ProviderCatalog[]>,
): Promise<ProjectAgentDefaults> {
  const { config, source, error } = configuration
  if (error) return { status: 'invalid', source }
  if (!config.agent?.preferredProvider && !config.agent?.preferredModel) return { status: 'none', source }
  const requested = {
    ...(config.agent.preferredProvider ? { provider: config.agent.preferredProvider } : {}),
    ...(config.agent.preferredModel ? { model: config.agent.preferredModel } : {}),
  }
  let catalogs: ProviderCatalog[]
  try {
    catalogs = await catalog()
  } catch {
    return { status: 'unavailable', source, requested, reason: 'catalog' }
  }
  const provider = config.agent.preferredProvider ?? defaultProvider
  const eligible = catalogs.find((entry) => entry.provider === provider)
  if (!eligible) return { status: 'unavailable', source, requested, reason: 'provider' }
  if (eligible.error) return { status: 'unavailable', source, requested, reason: 'catalog' }
  const model = config.agent.preferredModel
    ? eligible.models.find((entry) => entry.id === config.agent!.preferredModel)
    : (eligible.models.find((entry) => entry.isDefault) ?? eligible.models[0])
  if (!model || model.provider !== eligible.provider)
    return { status: 'unavailable', source, requested, reason: config.agent.preferredModel ? 'model' : 'provider' }
  return {
    status: 'ready',
    source,
    requested,
    selection: { provider: eligible.provider, model: model.id, effort: model.defaultEffort },
  }
}
