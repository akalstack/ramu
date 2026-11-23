import type { AgentProvider } from '@ramu/shared/types'

/** The kinds of setup step, in the order setup asks them. */
export const STEP_KINDS = [
  'agents',
  'mode',
  'model',
  'effort',
  'tokens',
  'access',
  'identities',
  'reach',
  'project',
] as const
export type StepKind = (typeof STEP_KINDS)[number]

/** One step of setup; the model and effort steps repeat for each provider, so each carries the provider it is for. */
export interface SetupStep {
  id: string
  kind: StepKind
  provider?: AgentProvider
}

/**
 * The steps setup walks through: a model step for each active provider, each followed by its effort step when that
 * provider's chosen model has efforts to choose. With no provider ready yet, one model step says how to get models.
 */
export function setupSteps(providers: AgentProvider[], hasEfforts: (provider: AgentProvider) => boolean): SetupStep[] {
  const perProvider: SetupStep[] = providers.length
    ? providers.flatMap((provider) => [
        { id: `model:${provider}`, kind: 'model' as const, provider },
        ...(hasEfforts(provider) ? [{ id: `effort:${provider}`, kind: 'effort' as const, provider }] : []),
      ])
    : [{ id: 'model', kind: 'model' }]
  return STEP_KINDS.flatMap((kind): SetupStep[] =>
    kind === 'model' ? perProvider : kind === 'effort' ? [] : [{ id: kind, kind }],
  )
}

/**
 * Where a step that is no longer offered lands: the step itself when it still exists, else the first one after it in
 * setup's order (a restored Effort step after the model changed, or a provider turned off since).
 */
export function stepIndex(steps: SetupStep[], id: string): number {
  const at = steps.findIndex((step) => step.id === id)
  if (at >= 0) return at
  const [kind, provider] = id.split(':') as [StepKind, AgentProvider | undefined]
  const rank = STEP_KINDS.indexOf(kind)
  if (rank < 0) return 0
  // A provider's own steps come before the next provider's, so an effort step that left lands on what followed it.
  const own = provider ? steps.findIndex((step) => step.provider === provider) : -1
  if (own >= 0 && kind === 'effort') {
    const next = steps.findIndex((step, index) => index > own && step.provider !== provider)
    return next >= 0 ? next : steps.length - 1
  }
  const later = steps.findIndex((step) => STEP_KINDS.indexOf(step.kind) > rank)
  return later >= 0 ? later : steps.length - 1
}
