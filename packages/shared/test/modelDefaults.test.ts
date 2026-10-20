import { describe, expect, it } from 'vitest'
import { migrateModelDefaults, recommendedSets } from '../src/providers/modelDefaults'
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
  it('renames generated Light steps while preserving the selected step and custom sets', () => {
    const defaults = recommendedSets([])
    const saved = {
      ...defaults,
      defaultStepId: 'astra-light',
      sets: defaults.sets.map((set) => ({
        ...set,
        steps: set.steps.map((step) => ({ ...step, name: step.name.replace(/ Low$/, ' Light') })),
      })),
    }
    const migrated = migrateModelDefaults(saved, defaults)
    expect(migrated.sets[0]!.steps.map((step) => step.name)).toEqual(defaults.sets[0]!.steps.map((step) => step.name))
    expect(migrated.defaultStepId).toBe('astra-light')
    const custom = {
      ...saved,
      sets: saved.sets.map((set) => ({
        ...set,
        steps: set.steps.map((step, index) => (index === 1 ? { ...step, name: 'My fast model' } : step)),
      })),
    }
    expect(migrateModelDefaults(custom, defaults)).toBe(custom)
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
  it('updates the earlier generated Medium default to Low', () => {
    const defaults = recommendedSets([]),
      saved = { ...defaults, defaultStepId: 'sol-medium' }
    expect(migrateModelDefaults(saved, defaults).defaultStepId).toBe('sol-light')
    expect(saved.defaultStepId).toBe('sol-medium')
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
  it('replaces untouched Codex defaults without Codex, but not an edited set', () => {
    const codexDefaults = recommendedSets([])
    const next = recommendedSets([claude])
    expect(migrateModelDefaults(codexDefaults, next).sets[0]!.steps[0]!.provider).toBe('claude-code')
    const edited = {
      ...codexDefaults,
      sets: codexDefaults.sets.map((set) => ({ ...set, steps: set.steps.slice(1) })),
    }
    expect(migrateModelDefaults(edited, next)).toBe(edited)
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
      expect(steps.length).toBeLessThanOrEqual(20)
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
  it('preserves user edits and an unavailable explicit default for review', () => {
    const initial = recommendedSets(catalogs)
    const next = recommendedSets([catalogs[0]!])
    const edited = structuredClone(initial)
    edited.sets[0]!.steps[0]!.effort = 'high'
    expect(migrateModelDefaults(edited, next)).toBe(edited)
    initial.defaultStepId = initial.sets[0]!.steps.find((step) => step.provider === 'cursor')!.id
    expect(migrateModelDefaults(initial, next)).toBe(initial)
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
