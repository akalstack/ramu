import type {
  AgentModel,
  AgentProvider,
  ModelPreferences,
  ModelSet,
  ModelStep,
  ProviderCatalog,
  ReasoningEffort,
} from '../types'

const GENERATED_ORDER: AgentProvider[] = ['codex', 'claude-code', 'antigravity', 'cursor', 'opencode']
const LADDER: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

/** Share five choices across usable providers, redistributing slots a small catalog cannot fill. */
function generatedFromCatalogs(catalogs: ProviderCatalog[]): ModelPreferences | null {
  const groups = GENERATED_ORDER.map((provider) => {
    const models = [
      ...new Map(
        catalogs
          .filter((catalog) => catalog.provider === provider)
          .flatMap((catalog) => catalog.models)
          .filter((model) => model.provider === provider)
          .map((model) => [model.id, model]),
      ).values(),
    ]
    return { provider, models, choices: providerChoices(provider, models), count: 0 }
  }).filter((group) => group.choices.length)
  if (!groups.length) return null
  let remaining = 5
  while (remaining) {
    let allocated = false
    for (const group of groups) {
      if (!remaining) break
      if (group.count >= group.choices.length) continue
      group.count++
      remaining--
      allocated = true
    }
    if (!allocated) break
  }
  const ranked = groups.flatMap(({ choices, count, models, provider }) => {
    const preferred =
      (provider === 'codex' ? choices.find((step) => step.id === 'sol-light') : undefined) ??
      choices.find((step) =>
        models.some((model) => model.isDefault && model.id === step.model && step.effort === model.defaultEffort),
      )
    // Where a step sits in its provider's own list, which already runs from light to capable.
    const at = (step: ModelStep) => choices.indexOf(step) / Math.max(1, choices.length - 1)
    if (count === 1) {
      const only = preferred ?? choices[0]!
      return [{ step: only, rank: rankOf(only, at(only)) }]
    }
    // Preserve the light/default/capable range as the allocation shrinks.
    const priorities =
      count === 2 && provider !== 'codex'
        ? [0, choices.length - 1]
        : [0, 1, choices.length - 1, 2, choices.length - 2, ...choices.map((_, index) => index)]
    const indices = [...new Set(priorities)]
      .filter((index) => index >= 0 && index < choices.length)
      .slice(0, count)
      .sort((a, b) => a - b)
    return indices.map((index) => ({ step: choices[index]!, rank: rankOf(choices[index]!, at(choices[index]!)) }))
  })
  // One ladder from the cheapest choice to the most capable, across providers: lighter model classes first, then each
  // provider's own order. Ties keep the provider order (the sort is stable).
  const steps = ranked.sort((a, b) => a.rank - b.rank).map(({ step }) => step)
  const selected =
    steps.find((step) => step.id === 'sol-light') ??
    steps.find((step) =>
      groups.some(({ models }) =>
        models.some(
          (model) =>
            model.isDefault &&
            model.provider === step.provider &&
            model.id === step.model &&
            model.defaultEffort === step.effort,
        ),
      ),
    ) ??
    steps[0]!
  const set: ModelSet = { id: 'recommended', name: 'Default', steps }
  set.generated = { fingerprint: fingerprint(set), defaultStepId: selected.id }
  return {
    defaultBarMode: 'model',
    sets: [set],
    defaultSetId: 'recommended',
    defaultStepId: selected.id,
  }
}

/** Light models (mini, flash, haiku…) rank before standard ones, and those before top models (opus, max, pro…). */
function modelClass(step: ModelStep): number {
  const name = `${step.model} ${step.name}`.toLowerCase()
  if (/\b(mini|nano|haiku|flash|lite|light|small|fast)\b/.test(name)) return 0
  if (/\b(opus|max|ultra|pro)\b/.test(name)) return 2
  return 1
}
const rankOf = (step: ModelStep, position: number) => modelClass(step) + position * 0.99

function providerChoices(provider: AgentProvider, models: AgentModel[]): ModelStep[] {
  const familyOrder = (model: AgentModel) => {
    if (provider !== 'claude-code') return model.isDefault ? 0 : 1
    const name = `${model.id} ${model.name}`.toLowerCase()
    return name.includes('sonnet') ? 0 : name.includes('opus') ? 1 : model.isDefault ? 2 : 3
  }
  const ordered = [...models].sort((a, b) => familyOrder(a) - familyOrder(b) || a.id.localeCompare(b.id))
  const step = (model: AgentModel, effort: ReasoningEffort | null): ModelStep => ({
    id: generatedStepId(provider, model.id, effort),
    name: `${model.name}${effort ? ` ${effort}` : ''}`.slice(0, 260),
    provider,
    model: model.id,
    effort,
  })
  const all = ordered.flatMap((model) =>
    model.efforts.length
      ? [...new Set(model.efforts)]
          .sort((a, b) => LADDER.indexOf(a) - LADDER.indexOf(b))
          .map((effort) => step(model, effort))
      : [step(model, null)],
  )
  const preferred =
    provider === 'codex'
      ? codexSteps(models)
      : ordered.flatMap((model, index) => {
          const efforts = [...new Set(model.efforts)].sort((a, b) => LADDER.indexOf(a) - LADDER.indexOf(b))
          const first = efforts.find((effort) => effort !== 'none' && effort !== 'minimal') ?? efforts[0]
          const middle = model.defaultEffort && efforts.includes(model.defaultEffort) ? model.defaultEffort : first
          const last = efforts.at(-1)
          return [...new Set(index === 0 ? [first, middle, last] : [middle, last])].map((effort) =>
            step(model, effort ?? null),
          )
        })
  const unique = new Map<string, ModelStep>()
  for (const entry of [...preferred, ...all]) {
    const key = JSON.stringify([entry.model, entry.effort])
    if (!unique.has(key)) unique.set(key, entry)
  }
  const choices = [...unique.values()].slice(0, 5)
  const defaultModel = ordered.find((model) => model.isDefault)
  const defaultChoice =
    defaultModel && all.find((entry) => entry.model === defaultModel.id && entry.effort === defaultModel.defaultEffort)
  if (
    defaultChoice &&
    !choices.some((entry) => entry.model === defaultChoice.model && entry.effort === defaultChoice.effort)
  )
    choices.splice(Math.min(1, choices.length), choices.length >= 5 ? 1 : 0, defaultChoice)
  return choices
}

const fingerprint = (set: ModelSet) =>
  JSON.stringify({
    name: set.name,
    steps: set.steps.map(({ id, name, provider, model, effort }) => ({ id, name, provider, model, effort })),
  })

/** Keep generated identifiers within the persisted ID limit even for long provider model names. */
function generatedStepId(provider: AgentProvider, model: string, effort: ReasoningEffort | null) {
  const readable = `${provider}-${model}-${effort ?? 'default'}`
  if (readable.length <= 100) return readable
  let hash = 2166136261
  for (let i = 0; i < model.length; i++) hash = Math.imul(hash ^ model.charCodeAt(i), 16777619)
  return `${provider}-${model.slice(0, 50)}-${(hash >>> 0).toString(16)}-${effort ?? 'default'}`
}

function codexSteps(models: AgentModel[]): ModelStep[] {
  const family = (name: string, preferred: string) =>
    models.find((model) => model.id === preferred) ??
    models.find(
      (model) => model.isDefault && new RegExp(String.raw`\b${name}\b`, 'i').test(`${model.name} ${model.id}`),
    ) ??
    models.find((model) => new RegExp(String.raw`\b${name}\b`, 'i').test(`${model.name} ${model.id}`))
  const luna = family('luna', 'gpt-6-luna')
  const sol = family('sol', 'gpt-6.1-sol')
  const astra = family('astra', 'gpt-6-astra')
  const candidates: [string, AgentModel | undefined, ReasoningEffort][] = [
    ['luna-high', luna, 'high'],
    ['sol-light', sol, 'low'],
    ['sol-medium', sol, 'medium'],
    ['astra-light', astra, 'low'],
    ['astra-medium', astra, 'medium'],
  ]
  return candidates.flatMap(([id, model, effort]) =>
    model?.efforts.includes(effort)
      ? [
          {
            id,
            name: `${model.name} ${effort[0]!.toUpperCase()}${effort.slice(1)}`,
            provider: 'codex' as const,
            model: model.id,
            effort,
          },
        ]
      : [],
  )
}

export function recommendedSets(catalogs: ProviderCatalog[]): ModelPreferences {
  const current = catalogs.map((catalog) => ({ ...catalog, models: catalog.models.filter((model) => !model.isLegacy) }))
  // Prefer current choices; an all-legacy catalog still supplies usable choices instead of invented placeholders.
  const generated = generatedFromCatalogs(current.some((catalog) => catalog.models.length) ? current : catalogs)
  if (generated) return generated
  // Before any usable catalog is known, retain the legacy placeholders. Clients validate availability before send.
  const step = (id: string, name: string, model: string, effort: ReasoningEffort): ModelStep => ({
    id,
    name,
    provider: 'codex',
    model,
    effort,
  })
  const steps = [
    step('luna-high', 'GPT-6 Luna High', 'gpt-6-luna', 'high'),
    step('sol-light', 'GPT-6.1 Sol Low', 'gpt-6.1-sol', 'low'),
    step('sol-medium', 'GPT-6.1 Sol Medium', 'gpt-6.1-sol', 'medium'),
    step('astra-light', 'GPT-6 Astra Low', 'gpt-6-astra', 'low'),
    step('astra-medium', 'GPT-6 Astra Medium', 'gpt-6-astra', 'medium'),
  ]
  return {
    defaultBarMode: 'model',
    sets: [{ id: 'recommended', name: 'Default', steps }],
    defaultSetId: 'recommended',
    defaultStepId: 'sol-light',
  }
}

/** Only untouched generated sets follow catalogs; custom content remains user-owned. */
export function isGeneratedModelSet(set: ModelSet): boolean {
  return (
    set.id === 'recommended' &&
    (set.generated?.fingerprint === fingerprint(set) || fingerprint(set) === fingerprint(recommendedSets([]).sets[0]!))
  )
}

/** Refresh proven generated content, replacing a default that no longer exists. */
export function migrateModelDefaults(value: ModelPreferences, defaults: ModelPreferences): ModelPreferences {
  const old = value.sets.find((set) => set.id === 'recommended')
  const next = defaults.sets.find((set) => set.id === 'recommended')
  if (!old || !next) return value
  const proven = old.generated ? old.generated.fingerprint === fingerprint(old) : fingerprint(old) === fingerprint(next)
  if (!proven) return value
  // An empty/offline catalog is not evidence that previously available providers disappeared.
  if (old.generated && !next.generated) return value
  const selectedHere = value.defaultSetId === old.id
  const selectedExists = next.steps.some((step) => step.id === value.defaultStepId)
  const defaultStepId = selectedHere && !selectedExists ? defaults.defaultStepId : value.defaultStepId
  if (
    fingerprint(old) === fingerprint(next) &&
    JSON.stringify(old.generated) === JSON.stringify(next.generated) &&
    defaultStepId === value.defaultStepId
  )
    return value
  return {
    ...value,
    sets: value.sets.map((set) => (set.id === old.id ? next : set)),
    defaultStepId,
  }
}
