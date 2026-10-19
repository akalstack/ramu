import type { AgentModel, AgentProvider, ModelPreferences, ModelStep, ProviderCatalog, ReasoningEffort } from '../types'

const GENERATED_ORDER: AgentProvider[] = ['claude-code', 'antigravity', 'cursor', 'opencode']
const LADDER: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

/**
 * When Codex is not among the active providers, build the set from what the enabled providers report: each
 * provider's default model at up to three of its own efforts (lowest practical, its default, a stronger one).
 * Nothing here names a model that no catalog lists.
 */
function generatedFromCatalogs(catalogs: ProviderCatalog[]): ModelPreferences | null {
  const steps: ModelStep[] = []
  let defaultStepId = ''
  for (const provider of GENERATED_ORDER) {
    const models = catalogs.filter((catalog) => catalog.provider === provider).flatMap((catalog) => catalog.models)
    const model = models.find((entry) => entry.isDefault) ?? models[0]
    if (!model) continue
    const efforts = [...model.efforts].sort((a, b) => LADDER.indexOf(a) - LADDER.indexOf(b))
    const chosen = efforts.length
      ? [
          ...new Set(
            [
              efforts.find((effort) => effort !== 'none' && effort !== 'minimal') ?? efforts[0]!,
              model.defaultEffort && efforts.includes(model.defaultEffort) ? model.defaultEffort : undefined,
              efforts.find((effort) => LADDER.indexOf(effort) > LADDER.indexOf(model.defaultEffort ?? 'medium')),
            ].filter((effort): effort is ReasoningEffort => !!effort),
          ),
        ].sort((a, b) => LADDER.indexOf(a) - LADDER.indexOf(b))
      : [null]
    for (const effort of chosen) {
      const id = `${provider}-${model.id}-${effort ?? 'default'}`
      steps.push({ id, name: `${model.name}${effort ? ` ${effort}` : ''}`, provider, model: model.id, effort })
      if (!defaultStepId && effort === (model.defaultEffort ?? chosen[0])) defaultStepId = id
    }
  }
  if (!steps.length) return null
  return {
    defaultBarMode: 'model',
    sets: [{ id: 'recommended', name: 'Default', steps }],
    defaultSetId: 'recommended',
    defaultStepId: defaultStepId || steps[0]!.id,
  }
}

export function recommendedSets(catalogs: ProviderCatalog[]): ModelPreferences {
  const hasCodex = catalogs.some((catalog) => catalog.provider === 'codex' && catalog.models.length)
  if (!hasCodex) {
    const generated = generatedFromCatalogs(catalogs)
    if (generated) return generated
  }
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
    step('sol-light', 'GPT-6.1 Sol Low', sol, 'gpt-6.1-sol', 'low'),
    step('sol-medium', 'GPT-6.1 Sol Medium', sol, 'gpt-6.1-sol', 'medium'),
    step('astra-light', 'GPT-6 Astra Low', astra, 'gpt-6-astra', 'low'),
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
  if (steps.every((step) => step.provider !== 'codex')) {
    // Codex is not active: replace only the untouched generated Codex set, never an edited one.
    const codex = recommendedSets([]).sets[0]!.steps
    const untouched =
      old.steps.length === codex.length &&
      old.steps.every((step, index) => {
        const expected = codex[index]!
        return step.id === expected.id && step.provider === expected.provider && step.model === expected.model
      })
    if (!untouched) return value
    const keep = old.steps.some((step) => step.id === value.defaultStepId)
    return {
      ...value,
      sets: value.sets.map((set) => (set.id === old.id ? { ...set, steps } : set)),
      defaultStepId: keep ? defaults.defaultStepId : value.defaultStepId,
    }
  }
  const oldNames = ['Light', 'Balanced', 'Deep', 'Advanced', 'Maximum']
  const oldIds = ['light', 'balanced', 'deep', 'advanced', 'maximum']
  const shortNames = ['Luna High', 'Sol Light', 'Sol Medium', 'Astra Light', 'Astra Medium']
  const isLegacy =
    old.steps.length === 5 &&
    old.steps.every((step, index) => step.id === oldIds[index] && step.name === oldNames[index])
  const isShort =
    old.steps.length === 5 &&
    old.steps.every((step, index) => step.id === steps[index]!.id && step.name === shortNames[index])
  const isRenamed =
    old.steps.length === steps.length &&
    old.steps.every((step, index) => {
      const expected = steps[index]!
      return (
        step.id === expected.id &&
        step.name === expected.name.replace(/ Low$/, ' Light') &&
        step.provider === expected.provider &&
        step.model === expected.model &&
        step.effort === expected.effort
      )
    })
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
  if (isCurrent && !replaceDefault) return value
  if (!isLegacy && !isShort && !isRenamed && !(isCurrent && replaceDefault)) return value
  return {
    ...value,
    sets: value.sets.map((set) => (set.id === old.id ? { ...set, steps } : set)),
    defaultStepId: replaceDefault ? defaults.defaultStepId : value.defaultStepId,
  }
}
