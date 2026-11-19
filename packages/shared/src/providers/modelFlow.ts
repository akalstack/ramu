import type { ModelPreferences } from '../types'

/** How the model bar offers choices: configured steps (`model`) or one model's efforts (`effort`). */
export type ModelFlow = 'model' | 'effort'
export type ModelFlowScope = 'device' | 'mobile' | 'all'
export type ModelFlowSource = ModelFlowScope | 'default'

export const isModelFlow = (value: unknown): value is ModelFlow => value === 'model' || value === 'effort'

export interface ResolvedModelFlow {
  flow: ModelFlow
  source: ModelFlowSource
}

type FlowPreferences = Pick<ModelPreferences, 'defaultBarMode' | 'mobileBarMode'> | null | undefined

/**
 * The selection flow a client uses. The host owns the all-device value (`defaultBarMode`) and the all-mobile value
 * (`mobileBarMode`) for the clients that use it; one phone keeps its own override on the phone. Narrower wins.
 * Desktop clients ignore the mobile layer.
 */
export function resolveModelFlow(
  preferences: FlowPreferences,
  options: { mobile: boolean; device?: unknown },
): ResolvedModelFlow {
  if (options.mobile && isModelFlow(options.device)) return { flow: options.device, source: 'device' }
  if (options.mobile && isModelFlow(preferences?.mobileBarMode))
    return { flow: preferences.mobileBarMode, source: 'mobile' }
  if (isModelFlow(preferences?.defaultBarMode)) return { flow: preferences.defaultBarMode, source: 'all' }
  return { flow: 'model', source: 'default' }
}

/** What a phone gets after removing the override at `scope`, shown before the person confirms. */
export function inheritedModelFlow(
  preferences: FlowPreferences,
  scope: 'device' | 'mobile',
  device?: unknown,
): ResolvedModelFlow {
  return resolveModelFlow(scope === 'mobile' ? { defaultBarMode: preferences?.defaultBarMode } : preferences, {
    mobile: true,
    device: scope === 'device' ? undefined : device,
  })
}
