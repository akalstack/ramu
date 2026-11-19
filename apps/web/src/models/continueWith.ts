import type { AgentSettings, FallbackStep, ProviderCatalog, UsageReading } from '@ramu/shared/types'
import { isOver, peakFor, resolveStep } from '@ramu/shared/providers/routing'

/**
 * The providers a thread held at a usage limit can continue on by hand: every other provider that is not known to be
 * limited, one model each. Your fallback order picks the model where it names the provider, else the provider's default.
 * A provider with no usage reading counts as available, since nothing says otherwise. Empty when every other provider is
 * limited (or there is no other), and then the menu offers nothing.
 */
export function continueOptions(input: {
  settings: Pick<AgentSettings, 'provider'>
  order: FallbackStep[]
  catalogs: ProviderCatalog[]
  usage: UsageReading[]
  now?: number
}): FallbackStep[] {
  const { settings, order, catalogs, usage, now = Date.now() } = input
  const steps = new Map<string, FallbackStep>()
  const add = (step: FallbackStep | null) => {
    if (step && step.provider !== settings.provider && !steps.has(step.provider)) steps.set(step.provider, step)
  }
  for (const entry of order) add(resolveStep(entry, catalogs))
  for (const catalog of catalogs) {
    const model = catalog.models.find((entry) => entry.isDefault) ?? catalog.models[0]
    if (!catalog.error && model)
      add(
        resolveStep(
          {
            id: `continue-${catalog.provider}`,
            provider: catalog.provider,
            model: model.id,
            effort: model.defaultEffort,
          },
          catalogs,
        ),
      )
  }
  return [...steps.values()].filter((step) => !isOver(peakFor(usage, step.provider, step.model, now), null))
}

/** The settings that move a thread onto `step`: the new model and effort, everything else (access, fallback, auto-resume) kept. */
export function settingsOnStep(settings: AgentSettings, step: FallbackStep): AgentSettings {
  const { accountId: _account, serviceTier: _tier, ...rest } = settings
  return {
    ...rest,
    provider: step.provider,
    model: step.model,
    effort: step.effort,
    ...(step.serviceTier ? { serviceTier: step.serviceTier } : {}),
  }
}
