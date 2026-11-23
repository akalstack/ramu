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
function initialChoice(saved: DefaultModelChoice, provider: AgentProvider, models: AgentModel[]): DefaultModelChoice {
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
 * The providers onboarding sets a model for, in the order it asks: installed, turned on and offering models, with the
 * one new threads start on first.
 */
export function activeProviders(
  installed: AgentProvider[],
  models: AgentModel[],
  lead: AgentProvider,
): AgentProvider[] {
  const offered = installed.filter((provider) => models.some((model) => model.provider === provider))
  return offered.includes(lead) ? [lead, ...offered.filter((provider) => provider !== lead)] : offered
}

/**
 * A provider's choice as onboarding shows it: what the person picked for it, else the saved default when it is this
 * provider's, else the provider's recommended model at its recommended effort.
 */
export function providerChoice(
  saved: DefaultModelChoice,
  provider: AgentProvider,
  models: AgentModel[],
  picked?: DefaultModelChoice,
): DefaultModelChoice {
  const known = (choice: DefaultModelChoice | undefined) =>
    choice?.provider === provider && models.some((model) => model.provider === provider && model.id === choice.model)
  return picked && known(picked) ? picked : initialChoice(saved, provider, models)
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
 * Where the choice sits in the sets: an existing step as it is, so the automatic set keeps following the catalog;
 * otherwise a new step beside the same model's other efforts in the default set, keeping the slider ordered from light
 * to thorough, or a new set when that one is full and `allowNewSet` says so.
 */
function placeStep(
  preferences: ModelPreferences,
  choice: DefaultModelChoice,
  name: string,
  allowNewSet: boolean,
): { preferences: ModelPreferences; setId: string; stepId: string } | null {
  if (!choice.model) return null
  const current = preferences.sets.find((set) => set.id === preferences.defaultSetId) ?? preferences.sets[0]
  const ordered = current ? [current, ...preferences.sets.filter((set) => set !== current)] : preferences.sets
  for (const set of ordered) {
    const found = set.steps.find((step) => sameStep(step, choice))
    if (found) return { preferences, setId: set.id, stepId: found.id }
  }
  const step: ModelStep = { id: crypto.randomUUID(), name: name.slice(0, 260), ...choice }
  if (!current || current.steps.length >= MAX_SET_STEPS) {
    if (!allowNewSet) return null
    const set = { id: crypto.randomUUID(), name: name.slice(0, 80), steps: [step] }
    return { preferences: { ...preferences, sets: [...preferences.sets, set] }, setId: set.id, stepId: step.id }
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
    preferences: { ...preferences, sets: preferences.sets.map((set) => (set === current ? { ...rest, steps } : set)) },
    setId: current.id,
    stepId: step.id,
  }
}

/** Makes the choice the step new threads start on. Returns the same object when nothing changes. */
export function withDefaultModel(
  preferences: ModelPreferences,
  choice: DefaultModelChoice,
  name: string,
): ModelPreferences {
  const placed = placeStep(preferences, choice, name, true)
  if (!placed) return preferences
  if (placed.setId === preferences.defaultSetId && placed.stepId === preferences.defaultStepId) return preferences
  return { ...placed.preferences, defaultSetId: placed.setId, defaultStepId: placed.stepId }
}

/**
 * Keeps another provider's choice one move away: a step in the default set, leaving where new threads start alone.
 * A full set is left as it is. Returns the same object when nothing changes.
 */
export function withModelStep(
  preferences: ModelPreferences,
  choice: DefaultModelChoice,
  name: string,
): ModelPreferences {
  return placeStep(preferences, choice, name, false)?.preferences ?? preferences
}
