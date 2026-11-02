import { describe, expect, it } from 'vitest'
import { isGeneratedModelSet, migrateModelDefaults, recommendedSets } from '../src/providers/modelDefaults'
import type { AgentProvider, ProviderCatalog } from '../src/types'

describe('new-thread model defaults', () => {
  it('defaults to GPT-6.1 Sol with Low reasoning even before the catalog loads', () => {
    const prefs = recommendedSets([])
    const selected = prefs.sets[0]!.steps.find((step) => step.id === prefs.defaultStepId)
    expect(selected).toMatchObject({
      provider: 'codex',
      model: 'gpt-6.1-sol',
      effort: 'low',
      name: 'GPT-6.1 Sol Low',
    })
  })
  it('prefers GPT-6.1 Sol over an older Sol catalog default', () => {
    const prefs = recommendedSets([
      {
        provider: 'codex',
        models: [
          {
            provider: 'codex',
            id: 'gpt-6-sol',
            name: 'GPT-6 Sol',
            isDefault: true,
            efforts: ['low', 'medium'],
            defaultEffort: 'medium',
          },
          {
            provider: 'codex',
            id: 'gpt-6.1-sol',
            name: 'GPT-6.1 Sol',
            isDefault: false,
            efforts: ['low', 'medium'],
            defaultEffort: 'medium',
          },
        ],
      },
    ])
    expect(prefs.sets[0]!.steps.find((step) => step.id === prefs.defaultStepId)?.model).toBe('gpt-6.1-sol')
  })
  it('preserves a different chosen step or an edited model set', () => {
    const defaults = recommendedSets([]),
      chosen = { ...defaults, defaultStepId: 'astra-medium' }
    expect(migrateModelDefaults(chosen, defaults)).toBe(chosen)
    const edited = structuredClone(defaults)
    edited.defaultStepId = 'sol-medium'
    edited.sets[0]!.steps[2]!.model = 'custom-sol'
    expect(migrateModelDefaults(edited, defaults)).toBe(edited)
  })
  it('does not re-save defaults already using Light', () => {
    const defaults = recommendedSets([])
    expect(migrateModelDefaults(defaults, defaults)).toBe(defaults)
  })
})

describe('generated defaults for the active providers', () => {
  const claude = {
    provider: 'claude-code' as const,
    models: [
      {
        provider: 'claude-code' as const,
        id: 'opus',
        name: 'Opus',
        isDefault: true,
        efforts: ['low', 'medium', 'high'] as ('low' | 'medium' | 'high')[],
        defaultEffort: 'medium' as const,
      },
    ],
  }
  it('builds steps only from models the enabled providers list', () => {
    const prefs = recommendedSets([claude])
    const steps = prefs.sets[0]!.steps
    expect(steps.map((step) => [step.provider, step.model, step.effort])).toEqual([
      ['claude-code', 'opus', 'low'],
      ['claude-code', 'opus', 'medium'],
      ['claude-code', 'opus', 'high'],
    ])
    expect(steps.find((step) => step.id === prefs.defaultStepId)?.effort).toBe('medium')
  })
  it('keeps Codex first in mixed sets while including the other active providers', () => {
    expect(recommendedSets([]).sets[0]!.steps[0]!.provider).toBe('codex')
    expect(
      recommendedSets([
        claude,
        {
          provider: 'codex',
          models: [{ ...claude.models[0]!, provider: 'codex', id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' }],
        },
      ]).sets[0]!.steps[0]!.provider,
    ).toBe('codex')
  })
})

describe('catalog refresh and mixed provider combinations', () => {
  const providers: AgentProvider[] = ['codex', 'claude-code', 'antigravity', 'cursor', 'opencode']
  const catalogs: ProviderCatalog[] = providers.map((provider) => ({
    provider,
    models: [
      {
        provider,
        id: provider === 'codex' ? 'gpt-6.1-sol' : `${provider}-default`,
        name: `${provider} model`,
        efforts: ['low', 'medium', 'high'],
        defaultEffort: 'medium',
        isDefault: true,
      },
    ],
  }))
  it.each(Array.from({ length: 31 }, (_, i) => i + 1))(
    'uses only actual models and efforts in combination %i',
    (mask) => {
      const active = catalogs.filter((_, i) => mask & (1 << i))
      const prefs = recommendedSets(active)
      const steps = prefs.sets[0]!.steps
      expect(new Set(steps.map((step) => step.provider))).toEqual(new Set(active.map((catalog) => catalog.provider)))
      for (const step of steps) {
        const model = active
          .find((catalog) => catalog.provider === step.provider)!
          .models.find((model) => model.id === step.model)!
        expect(model).toBeDefined()
        expect(model.efforts).toContain(step.effort)
      }
      expect(steps.some((step) => step.id === prefs.defaultStepId)).toBe(true)
      expect(recommendedSets([...active].reverse())).toEqual(prefs)
      expect(steps.length).toBe(Math.min(5, active.length * 3))
      expect(new Set(steps.map((step) => `${step.provider}:${step.model}:${step.effort}`)).size).toBe(steps.length)
    },
  )
  it('does not invent missing Codex families, unsupported efforts or effort controls', () => {
    const prefs = recommendedSets([
      {
        provider: 'codex',
        models: [{ ...catalogs[0]!.models[0]!, id: 'custom-sol', efforts: ['high'], defaultEffort: 'high' }],
      },
      { provider: 'cursor', models: [{ ...catalogs[3]!.models[0]!, efforts: [], defaultEffort: null }] },
    ])
    expect(prefs.sets[0]!.steps.map(({ provider, model, effort }) => [provider, model, effort])).toEqual([
      ['codex', 'custom-sol', 'high'],
      ['cursor', 'cursor-default', null],
    ])
  })
  it('finds a renamed Codex family without inventing the preferred model ID', () => {
    const prefs = recommendedSets([
      { provider: 'codex', models: [{ ...catalogs[0]!.models[0]!, id: 'gpt-next-sol', name: 'Next Sol' }] },
    ])
    expect(prefs.sets[0]!.steps.every((step) => step.model === 'gpt-next-sol')).toBe(true)
    expect(prefs.defaultStepId).toBe('sol-light')
  })
  it('refreshes untouched generated sets, preserves a surviving explicit step and all custom sets', () => {
    const initial = recommendedSets(catalogs)
    initial.defaultBarMode = 'effort'
    const chosen = initial.sets[0]!.steps.find((step) => step.provider === 'cursor')!
    initial.defaultStepId = chosen.id
    initial.sets.push({ id: 'custom', name: 'My set', steps: [{ ...chosen, id: 'my-step' }] })
    const next = recommendedSets(catalogs.filter((catalog) => catalog.provider !== 'opencode'))
    const result = migrateModelDefaults(initial, next)
    expect(result.sets[0]).toEqual(next.sets[0])
    expect(result.sets[1]).toBe(initial.sets[1])
    expect(result.defaultStepId).toBe(chosen.id)
    expect(result.defaultBarMode).toBe('effort')
    expect(migrateModelDefaults(result, next)).toBe(result)
  })
  it('preserves user edits but replaces an unavailable default in an automatic set', () => {
    const initial = recommendedSets(catalogs)
    const next = recommendedSets([catalogs[0]!])
    const edited = structuredClone(initial)
    edited.sets[0]!.steps[0]!.effort = 'high'
    expect(migrateModelDefaults(edited, next)).toBe(edited)
    initial.defaultStepId = initial.sets[0]!.steps.find((step) => step.provider === 'cursor')!.id
    const migrated = migrateModelDefaults(initial, next)
    expect(migrated.sets[0]).toEqual(next.sets[0])
    expect(migrated.defaultStepId).toBe(next.defaultStepId)
  })
  it('does not treat an empty or failed catalog as provider removal', () => {
    const initial = recommendedSets(catalogs)
    expect(migrateModelDefaults(initial, recommendedSets([]))).toBe(initial)
    expect(migrateModelDefaults(initial, recommendedSets([{ provider: 'codex', models: [] }]))).toBe(initial)
  })
  it('keeps long provider model identities intact while bounding persisted step IDs', () => {
    const model = `${'very-long-provider-model-'.repeat(7)}distinct-suffix`
    const prefs = recommendedSets([{ ...catalogs[1]!, models: [{ ...catalogs[1]!.models[0]!, id: model }] }])
    expect(prefs.sets[0]!.steps.every((step) => step.id.length <= 100 && step.model === model)).toBe(true)
    expect(new Set(prefs.sets[0]!.steps.map((step) => step.id)).size).toBe(prefs.sets[0]!.steps.length)
  })
  it('does not mistake a renamed or effort-edited legacy set for generated content', () => {
    const next = recommendedSets(catalogs)
    for (const edit of [
      (prefs: ReturnType<typeof recommendedSets>) => {
        prefs.sets[0]!.name = 'My defaults'
      },
      (prefs: ReturnType<typeof recommendedSets>) => {
        prefs.sets[0]!.steps[0]!.effort = 'low'
      },
    ]) {
      const initial = recommendedSets([])
      edit(initial)
      expect(migrateModelDefaults(initial, next)).toBe(initial)
    }
  })
})

describe('five-step allocations', () => {
  it('orders the set from the cheapest choice to the most capable across providers', () => {
    const model = (provider: 'claude-code' | 'antigravity', id: string, name: string, isDefault = false) => ({
      provider,
      id,
      name,
      efforts: [],
      defaultEffort: null,
      isDefault,
    })
    const steps = recommendedSets([
      {
        provider: 'claude-code',
        models: [model('claude-code', 'opus', 'Opus'), model('claude-code', 'sonnet', 'Sonnet', true)],
      },
      {
        provider: 'antigravity',
        models: [model('antigravity', 'pro', 'Gemini Pro'), model('antigravity', 'flash', 'Gemini Flash', true)],
      },
    ]).sets[0]!.steps.map((step) => step.model)
    expect(steps.indexOf('flash')).toBeLessThan(steps.indexOf('sonnet'))
    expect(steps.indexOf('sonnet')).toBeLessThan(steps.indexOf('opus'))
    expect(steps.at(-1) === 'opus' || steps.at(-1) === 'pro').toBe(true)
  })

  const codex: ProviderCatalog = {
    provider: 'codex',
    models: [
      {
        provider: 'codex',
        id: 'gpt-6-luna',
        name: 'GPT-6 Luna',
        efforts: ['high'],
        defaultEffort: 'high',
        isDefault: false,
      },
      {
        provider: 'codex',
        id: 'gpt-6.1-sol',
        name: 'GPT-6.1 Sol',
        efforts: ['low', 'medium'],
        defaultEffort: 'medium',
        isDefault: true,
      },
      {
        provider: 'codex',
        id: 'gpt-6-astra',
        name: 'GPT-6 Astra',
        efforts: ['low', 'medium'],
        defaultEffort: 'medium',
        isDefault: false,
      },
    ],
  }
  const claude: ProviderCatalog = {
    provider: 'claude-code',
    models: [
      {
        provider: 'claude-code',
        id: 'sonnet',
        name: 'Sonnet',
        efforts: ['low', 'medium', 'high'],
        defaultEffort: 'medium',
        isDefault: false,
      },
      {
        provider: 'claude-code',
        id: 'opus',
        name: 'Opus',
        efforts: ['low', 'medium', 'high'],
        defaultEffort: 'medium',
        isDefault: true,
      },
    ],
  }
  const providers: AgentProvider[] = ['codex', 'claude-code', 'antigravity', 'cursor', 'opencode']
  const catalogs: ProviderCatalog[] = [
    codex,
    claude,
    ...providers.slice(2).map((provider) => ({
      provider,
      models: [
        {
          provider,
          id: 'reported',
          name: 'Reported model',
          efforts: ['low', 'medium', 'high', 'xhigh', 'max'] as import('../src/types').ReasoningEffort[],
          defaultEffort: 'medium' as const,
          isDefault: true,
        },
      ],
    })),
  ]
  it.each(Array.from({ length: 31 }, (_, i) => i + 1))('shares exactly five slots in combination %i', (mask) => {
    const active = catalogs.filter((_, index) => mask & (1 << index))
    const steps = recommendedSets(active).sets[0]!.steps
    expect(steps).toHaveLength(5)
    active.forEach((catalog, index) =>
      expect(steps.filter((step) => step.provider === catalog.provider)).toHaveLength(
        Math.floor(5 / active.length) + (index < 5 % active.length ? 1 : 0),
      ),
    )
  })
  it('keeps the existing five Codex presets when Codex is alone', () => {
    expect(recommendedSets([codex]).sets[0]!.steps.map((step) => step.id)).toEqual(
      recommendedSets([]).sets[0]!.steps.map((step) => step.id),
    )
  })
  it('uses Luna High, Sol Low, Astra Medium and two Claude effort choices', () => {
    const prefs = recommendedSets([codex, { ...claude, models: claude.models.slice(1) }])
    expect(prefs.sets[0]!.steps.map(({ model, effort }) => [model, effort])).toEqual([
      ['gpt-6-luna', 'high'],
      ['gpt-6.1-sol', 'low'],
      ['gpt-6-astra', 'medium'],
      ['opus', 'low'],
      ['opus', 'high'],
    ])
    expect(prefs.defaultStepId).toBe('sol-light')
  })
  it('uses the reported default model and effort with one slot per provider', () => {
    const steps = recommendedSets(catalogs).sets[0]!.steps
    expect(steps.map(({ model, effort }) => [model, effort])).toEqual([
      ['gpt-6.1-sol', 'low'],
      ['reported', 'medium'],
      ['reported', 'medium'],
      ['reported', 'medium'],
      // The top model class comes last: the set runs from the cheapest choice to the most capable.
      ['opus', 'medium'],
    ])
  })
  it('redistributes an unfillable slot without duplicating choices', () => {
    const prefs = recommendedSets([
      codex,
      {
        provider: 'cursor',
        models: [
          {
            provider: 'cursor',
            id: 'auto',
            name: 'Auto',
            efforts: [],
            defaultEffort: null,
            isDefault: true,
          },
        ],
      },
    ])
    expect(prefs.sets[0]!.steps.map((step) => step.provider)).toEqual(['codex', 'cursor', 'codex', 'codex', 'codex'])
  })
  it('recognizes only untouched automatic content as read-only', () => {
    const set = recommendedSets([codex, claude]).sets[0]!
    expect(isGeneratedModelSet(set)).toBe(true)
    expect(isGeneratedModelSet({ ...set, name: 'My choices' })).toBe(false)
    expect(isGeneratedModelSet(recommendedSets([]).sets[0]!)).toBe(true)
    expect(isGeneratedModelSet({ id: 'custom', name: 'Custom', steps: set.steps })).toBe(false)
  })
})

it('omits legacy choices from automatic defaults while preserving custom sets that use them', () => {
  const catalog: ProviderCatalog = {
    provider: 'codex',
    models: [
      {
        provider: 'codex',
        id: 'gpt-6-sol',
        name: 'GPT-6 Sol',
        efforts: ['low', 'medium'],
        defaultEffort: 'medium',
        isDefault: true,
      },
      {
        provider: 'codex',
        id: 'gpt-6.1-sol',
        name: 'GPT-6.1 Sol',
        efforts: ['low', 'medium'],
        defaultEffort: 'medium',
        isDefault: false,
      },
    ],
  }
  const before = recommendedSets([catalog])
  before.sets.push({
    id: 'custom-old',
    name: 'Keep older Sol',
    steps: [
      {
        id: 'older-sol',
        name: 'Older Sol',
        provider: 'codex',
        model: 'gpt-6-sol',
        effort: 'medium',
      },
    ],
  })
  const next = recommendedSets([
    {
      ...catalog,
      models: catalog.models.map((model) => (model.id === 'gpt-6-sol' ? { ...model, isLegacy: true } : model)),
    },
  ])
  expect(next.sets[0]!.steps.every((step) => step.model === 'gpt-6.1-sol')).toBe(true)
  expect(migrateModelDefaults(before, next).sets[1]).toBe(before.sets[1])
})

it('uses actual catalog choices when only legacy models are reported', () => {
  const prefs = recommendedSets([
    {
      provider: 'cursor',
      models: [
        {
          provider: 'cursor',
          id: 'old',
          name: 'Old',
          efforts: [],
          defaultEffort: null,
          isDefault: true,
          isLegacy: true,
        },
      ],
    },
  ])
  expect(prefs.sets[0]!.steps).toMatchObject([{ provider: 'cursor', model: 'old', effort: null }])
})

it('uses a custom Codex catalog default effort when Codex receives a single slot', () => {
  const catalogs: ProviderCatalog[] = (
    ['codex', 'claude-code', 'antigravity', 'cursor', 'opencode'] as AgentProvider[]
  ).map((provider) => ({
    provider,
    models: [
      {
        provider,
        id: 'reported-model',
        name: 'Reported',
        efforts: ['low', 'medium'],
        defaultEffort: 'medium',
        isDefault: true,
      },
    ],
  }))
  const steps = recommendedSets(catalogs).sets[0]!.steps
  expect(steps).toHaveLength(5)
  expect(steps[0]).toMatchObject({ provider: 'codex', model: 'reported-model', effort: 'medium' })
})
