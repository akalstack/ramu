import { isModelListed, type VisibleModels } from '@ramu/shared/providers/modelVisibility'
import type { AgentModel, AgentProvider, ModelPreferences, ModelStep, ReasoningEffort } from '@ramu/shared/types'
import { MAX_SET_STEPS } from '../settings/constants'

/** The model and effort new threads start on, as onboarding picks them. */
export interface DefaultModelChoice {
  provider: AgentProvider
  model: string
  effort: ReasoningEffort | null
}

const LADDER: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

/** The models onboarding offers for a provider: current, listed ones first, with the provider's default on top. */
export function onboardingModels(models: AgentModel[], provider: AgentProvider, visible: VisibleModels): AgentModel[] {
  const own = models.filter((model) => model.provider === provider)
  const current = own.filter((model) => !model.isLegacy && isModelListed(visible, model))
  return [...(current.length ? current : own)].sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
}

/** The efforts worth a step of their own: a model with one effort or none has nothing to choose. */
export const choosableEfforts = (model: AgentModel | undefined) =>
  model && new Set(model.efforts).size > 1
    ? [...new Set(model.efforts)].sort((a, b) => LADDER.indexOf(a) - LADDER.indexOf(b))
    : []

/** Where onboarding starts: the saved default when its provider can run here, else that provider's own default. */
export function initialChoice(
  saved: DefaultModelChoice,
  provider: AgentProvider,
  models: AgentModel[],
): DefaultModelChoice {
  const own = models.filter((model) => model.provider === provider)
  const kept =
    saved.provider === provider
      ? own.find((model) => model.id === saved.model || (!saved.model && model.isDefault))
      : undefined
  if (kept) return withModel(kept, saved.effort)
  const fallback = own.find((model) => model.isDefault) ?? own[0]
  return fallback ? withModel(fallback, null) : { provider, model: '', effort: null }
}

/**
 * The choice as onboarding shows it: a saved default on a provider not installed here moves to one that is (preferring
 * one with models), and "the provider's default model" names the model it means.
 */
export function shownChoice(
  choice: DefaultModelChoice,
  installed: AgentProvider[],
  models: AgentModel[],
): DefaultModelChoice {
  if (installed.length && !installed.includes(choice.provider)) {
    const provider = installed.find((entry) => models.some((model) => model.provider === entry)) ?? installed[0]!
    return initialChoice(choice, provider, models)
  }
  const known = models.some((model) => model.provider === choice.provider && model.id === choice.model)
  return known ? choice : initialChoice(choice, choice.provider, models)
}

/** Switching model keeps the effort when the new model supports it, else takes the model's own default. */
export function withModel(model: AgentModel, effort: ReasoningEffort | null): DefaultModelChoice {
  return {
    provider: model.provider,
    model: model.id,
    effort: effort && model.efforts.includes(effort) ? effort : (model.defaultEffort ?? model.efforts[0] ?? null),
  }
}

const sameStep = (step: ModelStep, choice: DefaultModelChoice) =>
  step.provider === choice.provider && step.model === choice.model && step.effort === choice.effort

/**
 * Makes the choice the step new threads start on. An existing step is selected as it is, so the automatic set keeps
 * following the catalog; otherwise the choice joins the default set beside the same model's other efforts, keeping the
 * slider ordered from light to thorough. Returns the same object when nothing changes.
 */
export function withDefaultModel(
  preferences: ModelPreferences,
  choice: DefaultModelChoice,
  name: string,
): ModelPreferences {
  if (!choice.model) return preferences
  const current = preferences.sets.find((set) => set.id === preferences.defaultSetId) ?? preferences.sets[0]
  const ordered = current ? [current, ...preferences.sets.filter((set) => set !== current)] : preferences.sets
  for (const set of ordered) {
    const found = set.steps.find((step) => sameStep(step, choice))
    if (!found) continue
    if (set.id === preferences.defaultSetId && found.id === preferences.defaultStepId) return preferences
    return { ...preferences, defaultSetId: set.id, defaultStepId: found.id }
  }
  const step: ModelStep = { id: crypto.randomUUID(), name: name.slice(0, 260), ...choice }
  if (!current || current.steps.length >= MAX_SET_STEPS) {
    const set = { id: crypto.randomUUID(), name: name.slice(0, 80), steps: [step] }
    return { ...preferences, sets: [...preferences.sets, set], defaultSetId: set.id, defaultStepId: step.id }
  }
  const rank = (effort: ReasoningEffort | null) => (effort ? LADDER.indexOf(effort) : -1)
  const siblings = current.steps.flatMap((entry, index) =>
    entry.provider === choice.provider && entry.model === choice.model ? [{ entry, index }] : [],
  )
  const after = siblings.filter(({ entry }) => rank(entry.effort) < rank(choice.effort)).at(-1)
  const at = siblings.length ? (after ? after.index + 1 : siblings[0]!.index) : current.steps.length
  const steps = [...current.steps.slice(0, at), step, ...current.steps.slice(at)]
  const { generated: _generated, ...rest } = current
  return {
    ...preferences,
    sets: preferences.sets.map((set) => (set === current ? { ...rest, steps } : set)),
    defaultSetId: current.id,
    defaultStepId: step.id,
  }
}
