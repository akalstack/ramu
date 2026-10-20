import { expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type AgentModel } from '@ramu/shared/types'
import { visiblePickerModels } from '../src/models/modelVisibility'

const models: AgentModel[] = [
  { provider: 'codex', id: 'current', name: 'Current', efforts: ['low'], defaultEffort: 'low', isDefault: true },
  {
    provider: 'codex',
    id: 'old',
    name: 'Old',
    efforts: ['low'],
    defaultEffort: 'low',
    isDefault: false,
    isLegacy: true,
  },
  {
    provider: 'claude-code',
    id: 'old',
    name: 'Old Claude',
    efforts: [],
    defaultEffort: null,
    isDefault: false,
    isLegacy: true,
  },
]
const options = {
  showLegacy: false,
  query: '',
  settings: { ...DEFAULT_AGENT_SETTINGS, provider: 'codex' as const, model: 'current' },
  favorites: [] as string[],
}

it('hides legacy choices by default and reveals them with the presentation toggle or search', () => {
  expect(visiblePickerModels(models, options)).toEqual([models[0]])
  expect(visiblePickerModels(models, { ...options, showLegacy: true })).toEqual(models)
  expect(visiblePickerModels(models, { ...options, query: 'old' })).toEqual(models)
  expect(visiblePickerModels(models, { ...options, query: ' ' })).toEqual([models[0]])
})

it('keeps selected and favorited legacy choices visible, qualified by provider', () => {
  expect(visiblePickerModels(models, { ...options, settings: { ...options.settings, model: 'old' } })).toEqual([
    models[0],
    models[1],
  ])
  expect(visiblePickerModels(models, { ...options, favorites: ['claude-code:old'] })).toEqual([models[0], models[2]])
  expect(models[1]!.isLegacy).toBe(true)
})
