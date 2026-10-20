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

/** Deterministic provider groups; each step uses a model and effort reported by that provider. */
function generatedFromCatalogs(catalogs: ProviderCatalog[]): ModelPreferences | null {
  const steps: ModelStep[] = []
  let defaultStepId = ''
  for (const provider of GENERATED_ORDER) {
    const models = catalogs
      .filter((catalog) => catalog.provider === provider)
      .flatMap((catalog) => catalog.models)
      .filter((model) => model.provider === provider)
    if (provider === 'codex') {
      const codex = codexSteps(models)
      if (codex.length) {
        steps.push(...codex)
        defaultStepId = codex.find((step) => step.id === 'sol-light')?.id ?? codex[0]!.id
        continue
      }
    }
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
      const id = generatedStepId(provider, model.id, effort)
      steps.push({
        id,
        name: `${model.name}${effort ? ` ${effort}` : ''}`.slice(0, 260),
        provider,
        model: model.id,
        effort,
      })
      if (!defaultStepId && effort === (model.defaultEffort ?? chosen[0])) defaultStepId = id
    }
  }
  if (!steps.length) return null
  const selected = defaultStepId || steps[0]!.id
  const set: ModelSet = { id: 'recommended', name: 'Default', steps }
  set.generated = { fingerprint: fingerprint(set), defaultStepId: selected }
  return {
    defaultBarMode: 'model',
    sets: [set],
    defaultSetId: 'recommended',
    defaultStepId: selected,
  }
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
  const generated = generatedFromCatalogs(catalogs)
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

/** Refresh only proven generated content. An unavailable explicit default remains available for correction. */
export function migrateModelDefaults(value: ModelPreferences, defaults: ModelPreferences): ModelPreferences {
  const old = value.sets.find((set) => set.id === 'recommended')
  const next = defaults.sets.find((set) => set.id === 'recommended')
  if (!old || !next) return value
  const legacy = recommendedSets([]).sets[0]!
  const oldNames = ['Light', 'Balanced', 'Deep', 'Advanced', 'Maximum']
  const oldIds = ['light', 'balanced', 'deep', 'advanced', 'maximum']
  const shortNames = ['Luna High', 'Sol Light', 'Sol Medium', 'Astra Light', 'Astra Medium']
  const legacyMatch =
    old.name === legacy.name &&
    old.steps.length === legacy.steps.length &&
    old.steps.every((step, index) => {
      const expected = legacy.steps[index]!
      return (
        step.provider === expected.provider &&
        step.model === expected.model &&
        step.effort === expected.effort &&
        ((step.id === expected.id &&
          [expected.name, expected.name.replace(/ Low$/, ' Light'), shortNames[index]].includes(step.name)) ||
          (step.id === oldIds[index] && step.name === oldNames[index]))
      )
    })
  const proven = old.generated
    ? old.generated.fingerprint === fingerprint(old)
    : legacyMatch || fingerprint(old) === fingerprint(next)
  if (!proven) return value
  // An empty/offline catalog is not evidence that previously available providers disappeared.
  if (old.generated && !next.generated) return value
  const selectedHere = value.defaultSetId === old.id
  const selectedExists = next.steps.some((step) => step.id === value.defaultStepId)
  const generatedDefault = old.generated?.defaultStepId ?? 'sol-light'
  const earlierDefault = !old.generated && value.defaultStepId === 'sol-medium'
  if (selectedHere && !selectedExists && value.defaultStepId !== generatedDefault && !earlierDefault) return value
  const defaultStepId =
    selectedHere && (!selectedExists || earlierDefault) ? defaults.defaultStepId : value.defaultStepId
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
