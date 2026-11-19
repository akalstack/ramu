import { expect, it, vi } from 'vitest'
import type { AgentModel, ProviderCatalog } from '@ramu/shared/types'
import { classifyLegacyCatalog, modelLegacyMetadata } from '../src/providers/modelLifecycle'
import { CatalogService } from '../src/agent/catalogService'
import * as discovery from '../src/agent/catalog'

const model = (
  id: string,
  provider: AgentModel['provider'] = 'codex',
  extra: Partial<AgentModel> = {},
): AgentModel => ({
  provider,
  id,
  name: id,
  efforts: ['low', 'medium'],
  defaultEffort: 'medium',
  isDefault: false,
  ...extra,
})
const classify = (models: AgentModel[], provider: AgentModel['provider'] = 'codex') =>
  classifyLegacyCatalog({ provider, models }).models

it('classifies older Codex versions only within the same reported family', () => {
  const models = classify([
    model('gpt-6-sol'),
    model('gpt-6.1-sol'),
    model('gpt-6-luna'),
    model('gpt-6-astra'),
    model('gpt-6.1-sol-custom'),
    model('company-model'),
  ])
  expect(models.filter((entry) => entry.isLegacy).map((entry) => entry.id)).toEqual(['gpt-6-sol'])
  expect(classify([model('gpt-6-sol')])[0]!.isLegacy).toBeUndefined()
  expect(classify([model('gpt-6.9-sol'), model('gpt-6.10-sol')])[0]!.isLegacy).toBe(true)
})

it('recognizes versioned Claude families, preserving aliases and custom IDs', () => {
  const models = classify(
    [
      model('claude-sonnet-4-5-20250929', 'claude-code'),
      model('claude-sonnet-4-6', 'claude-code'),
      model('claude-3-7-sonnet-20250219', 'claude-code'),
      model('claude-opus-4-5', 'claude-code'),
      model('sonnet', 'claude-code'),
      model('custom-sonnet-4-5', 'claude-code'),
    ],
    'claude-code',
  )
  expect(models.filter((entry) => entry.isLegacy).map((entry) => entry.id)).toEqual([
    'claude-sonnet-4-5-20250929',
    'claude-3-7-sonnet-20250219',
  ])
})

it('respects explicit provider metadata and never treats hidden as legacy', () => {
  expect(modelLegacyMetadata({ hidden: true })).toEqual({})
  expect(modelLegacyMetadata({ status: 'current' })).toEqual({ isLegacy: false })
  expect(modelLegacyMetadata({ isLegacy: false, deprecated: true })).toEqual({ isLegacy: false })
  for (const raw of [{ isLegacy: true }, { isDeprecated: true }, { deprecated: true }, { status: 'legacy' }])
    expect(modelLegacyMetadata(raw)).toEqual({ isLegacy: true })
  expect(classify([model('gpt-6-sol', 'codex', { isLegacy: false }), model('gpt-6.1-sol')])[0]!.isLegacy).toBe(false)
  expect(classify([model('gpt-6-sol'), model('gpt-6.1-sol', 'codex', { isLegacy: true })])[0]!.isLegacy).toBeUndefined()
  expect(classify([model('gpt-6-sol'), model('gpt-6.1-sol', 'cursor')])[0]!.isLegacy).toBeUndefined()
})

it('publishes lifecycle metadata through the cached host catalog without removing old models', async () => {
  vi.stubEnv('RAMU_FAKE_AGENT', '0')
  const raw: ProviderCatalog[] = [{ provider: 'codex', models: [model('gpt-6-sol'), model('gpt-6.1-sol')] }]
  const discovered = vi.spyOn(discovery, 'discoverCatalogs').mockResolvedValue(raw)
  const service = new CatalogService({
    catalog: async () => [],
    preferences: () => undefined,
    providerQuery: () => {
      throw new Error('Should not start an agent')
    },
  })
  try {
    const result = await service.discoverCatalog(false)
    expect(result[0]!.models).toHaveLength(2)
    expect(result[0]!.models[0]!.isLegacy).toBe(true)
    expect(await service.discoverCatalog(false)).toBe(result)
    expect(discovered).toHaveBeenCalledTimes(1)
    expect(raw[0]!.models[0]!.isLegacy).toBeUndefined()
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  }
})
