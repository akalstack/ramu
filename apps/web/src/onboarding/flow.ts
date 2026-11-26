import type { AgentProvider } from '@ramu/shared/types'

/** The kinds of setup step, in the order setup asks them. */
export const STEP_KINDS = ['agents', 'mode', 'model', 'tokens', 'access', 'identities', 'reach', 'project'] as const
export type StepKind = (typeof STEP_KINDS)[number]

/** One step of setup; the model step repeats for each provider, so each carries the provider it is for. */
export interface SetupStep {
  id: string
  kind: StepKind
  provider?: AgentProvider
}

/**
 * The steps setup walks through: one step for each active provider, choosing its model and that model's effort
 * together. With no provider ready yet, one model step says how to get models.
 */
export function setupSteps(providers: AgentProvider[]): SetupStep[] {
  const perProvider: SetupStep[] = providers.length
    ? providers.map((provider) => ({ id: `model:${provider}`, kind: 'model' as const, provider }))
    : [{ id: 'model', kind: 'model' }]
  return STEP_KINDS.flatMap((kind): SetupStep[] => (kind === 'model' ? perProvider : [{ id: kind, kind }]))
}

/**
 * Where a step that is no longer offered lands: the step itself when it still exists, else the first one after it in
 * setup's order (a provider turned off since).
 */
export function stepIndex(steps: SetupStep[], id: string): number {
  // Setup used to ask effort on its own step; progress saved there returns to that provider's combined step.
  const at = steps.findIndex((step) => step.id === id.replace(/^effort:/, 'model:'))
  if (at >= 0) return at
  const [kind] = id.split(':') as [string]
  const rank = STEP_KINDS.indexOf((kind === 'effort' ? 'model' : kind) as StepKind)
  if (rank < 0) return 0
  const later = steps.findIndex((step) => STEP_KINDS.indexOf(step.kind) > rank)
  return later >= 0 ? later : steps.length - 1
}
