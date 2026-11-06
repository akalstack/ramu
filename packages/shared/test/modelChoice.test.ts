import { expect, it } from 'vitest'
import type { AgentModel, ProviderCatalog } from '../src/types'
import { agentModelList, findModelByHandle } from '../src/chat/modelChoice'

const model = (provider: AgentModel['provider'], id: string, name: string, extra: Partial<AgentModel> = {}) =>
  ({ provider, id, name, efforts: [], defaultEffort: null, isDefault: false, ...extra }) as AgentModel

const catalogs: ProviderCatalog[] = [
  {
    provider: 'claude-code',
    models: [
      model('claude-code', 'claude-old', 'Opus 5.5', { isLegacy: true }),
      model('claude-code', 'claude-opus', 'Opus 5.5'),
      model('claude-code', 'claude-sonnet', 'Sonnet 5.5', { isDefault: true }),
    ],
  },
  { provider: 'codex', models: [model('codex', 'gpt-x', 'GPT X')], error: 'Signed out' },
]

it('finds a current model by handle before a legacy one, and by id', () => {
  const models = catalogs.flatMap((catalog) => catalog.models)
  expect(findModelByHandle(models, '@Opus-5.5')?.id).toBe('claude-opus')
  expect(findModelByHandle(models, 'gpt-x')?.id).toBe('gpt-x')
  expect(findModelByHandle(models, 'nope')).toBeUndefined()
})

it('lists current models per provider with the default first, says which cannot run, and narrows by query', () => {
  const [claude, codex] = agentModelList(catalogs)
  expect(claude!.models.map((entry) => entry.handle)).toEqual(['sonnet-5.5', 'opus-5.5'])
  expect(codex).toMatchObject({ unavailable: 'Signed out', more: 0 })
  expect(agentModelList(catalogs, 'opus')).toEqual([
    expect.objectContaining({ provider: 'claude-code', models: [expect.objectContaining({ handle: 'opus-5.5' })] }),
  ])
  expect(agentModelList(catalogs, '', 1)[0]).toMatchObject({ more: 1 })
})
