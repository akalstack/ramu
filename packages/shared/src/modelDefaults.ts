import type { AgentModel, ModelPreferences, ModelStep, ProviderCatalog, ReasoningEffort } from './types'

export function recommendedSets(catalogs: ProviderCatalog[]): ModelPreferences {
  const models = catalogs.flatMap((catalog) => catalog.models).filter((model) => model.provider === 'codex')
  const family = (name: string, preferred: string) =>
    models.find((model) => model.id === preferred) ??
    models.find((model) => model.isDefault && new RegExp(`\\b${name}\\b`, 'i').test(`${model.name} ${model.id}`)) ??
    models.find((model) => new RegExp(`\\b${name}\\b`, 'i').test(`${model.name} ${model.id}`))
  const luna = family('luna', 'gpt-6-luna')
  const sol = family('sol', 'gpt-6.1-sol')
  const astra = family('astra', 'gpt-6-astra')
  const step = (
    id: string,
    name: string,
    model: AgentModel | undefined,
    fallbackId: string,
    effort: ReasoningEffort,
  ): ModelStep => ({ id, name, provider: 'codex', model: model?.id ?? fallbackId, effort })
  const steps = [
    step('luna-high', 'GPT-6 Luna High', luna, 'gpt-6-luna', 'high'),
    step('sol-light', 'GPT-6.1 Sol Light', sol, 'gpt-6.1-sol', 'low'),
    step('sol-medium', 'GPT-6.1 Sol Medium', sol, 'gpt-6.1-sol', 'medium'),
    step('astra-light', 'GPT-6 Astra Light', astra, 'gpt-6-astra', 'low'),
    step('astra-medium', 'GPT-6 Astra Medium', astra, 'gpt-6-astra', 'medium'),
  ]
  return {
    defaultBarMode: 'model',
    sets: [{ id: 'recommended', name: 'Default', steps }],
    defaultSetId: 'recommended',
    defaultStepId: 'sol-light',
  }
}

/** Update generated defaults while retaining edited sets and other selected configurations. */
export function migrateModelDefaults(value: ModelPreferences, defaults: ModelPreferences): ModelPreferences {
  const old = value.sets.find((set) => set.id === 'recommended')
  if (!old) return value
  const steps = defaults.sets[0]!.steps
  const oldNames = ['Light', 'Balanced', 'Deep', 'Advanced', 'Maximum']
  const oldIds = ['light', 'balanced', 'deep', 'advanced', 'maximum']
  const shortNames = ['Luna High', 'Sol Light', 'Sol Medium', 'Astra Light', 'Astra Medium']
  const isLegacy =
    old.steps.length === 5 &&
    old.steps.every((step, index) => step.id === oldIds[index] && step.name === oldNames[index])
  const isShort =
    old.steps.length === 5 &&
    old.steps.every((step, index) => step.id === steps[index]!.id && step.name === shortNames[index])
  const isCurrent =
    old.steps.length === steps.length &&
    old.steps.every((step, index) => {
      const expected = steps[index]!
      return (
        step.id === expected.id &&
        step.name === expected.name &&
        step.provider === expected.provider &&
        step.model === expected.model &&
        step.effort === expected.effort
      )
    })
  const replaceDefault = value.defaultSetId === old.id && (isLegacy || value.defaultStepId === 'sol-medium')
  if (!isLegacy && !isShort && !(isCurrent && replaceDefault)) return value
  return {
    ...value,
    sets: value.sets.map((set) => (set.id === old.id ? { ...set, steps } : set)),
    defaultStepId: replaceDefault ? defaults.defaultStepId : value.defaultStepId,
  }
}
