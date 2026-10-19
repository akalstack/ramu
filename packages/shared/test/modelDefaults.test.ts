import { describe, expect, it } from 'vitest'
import { migrateModelDefaults, recommendedSets } from '../src/providers/modelDefaults'

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
