import { expect, it } from 'vitest'
import {
  commonSettings,
  intersectCatalogs,
  portableSettings,
  schemaKey,
  type SettingsSnapshot,
  type SettingSchema,
} from '../src/settingsCompatibility'

const snapshot = (schema: SettingSchema, value: unknown = 'blue'): SettingsSnapshot => ({
  protocol: 1,
  settings: [{ path: 'accent', schema, value }],
})
it('offers only choices accepted by every version, regardless of saved values', () => {
  const fields = commonSettings([
    snapshot({ type: 'string', enum: ['blue', 'teal'] }),
    snapshot({ type: 'string', enum: ['teal', 'violet'] }, 'violet'),
  ])
  expect(fields[0]?.schema.enum).toEqual(['teal'])
  expect(
    commonSettings([snapshot({ type: 'string', enum: ['blue'] }), snapshot({ type: 'string', enum: ['teal'] })]),
  ).toEqual([])
})
it('does not infer compatibility from current values or missing capabilities', () => {
  expect(commonSettings([snapshot({ type: 'string' }), { protocol: 1, settings: [] }])).toEqual([])
  expect(commonSettings([snapshot({ type: 'string' }), snapshot({ type: 'number' })])).toEqual([])
  expect(commonSettings([])).toEqual([])
})
it('requires matching list-item formats', () => {
  for (const schemas of [
    [
      { type: 'array', items: { type: 'string', enum: ['a'] } },
      { type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
    ],
  ])
    expect(commonSettings(schemas.map((schema) => snapshot(schema)))).toEqual([])
})
it('ignores defaults and key order while retaining validation constraints', () => {
  expect(schemaKey({ type: 'string', default: 'a', maxLength: 10 })).toBe(
    schemaKey({ maxLength: 10, type: 'string', default: 'b' }),
  )
  expect(
    commonSettings([snapshot({ type: 'string', default: 'a' }), snapshot({ type: 'string', default: 'b' })]),
  ).toHaveLength(1)
})
it('advertises provider configuration and complex lists while excluding migration markers', () => {
  const schema: SettingSchema = {
    properties: {
      accent: { type: 'string' },
      memory: { type: 'object', properties: { enabled: { type: 'boolean' } } },
      providerBinaries: { type: 'object', properties: { binary: { type: 'string' } } },
      messageBehaviorVersion: { type: 'number' },
      favoriteModels: { type: 'array', items: { type: 'string' } },
      steps: { type: 'array', items: { type: 'object' } },
    },
  }
  expect(
    portableSettings(schema, {
      accent: 'blue',
      memory: { enabled: true },
      providerBinaries: { binary: '/secret' },
      messageBehaviorVersion: 4,
      favoriteModels: [],
      steps: [],
    }).map((field) => field.path),
  ).toEqual(['accent', 'memory.enabled', 'providerBinaries.binary', 'favoriteModels', 'steps'])
})

it('intersects model catalogs and reasoning efforts across independently updated computers', () => {
  const model = (id: string, efforts: import('../src/types').ReasoningEffort[]): import('../src/types').AgentModel => ({
    provider: 'codex',
    id,
    name: id,
    efforts,
    defaultEffort: 'low',
    isDefault: true,
  })
  const result = intersectCatalogs([
    [{ provider: 'codex', models: [model('shared', ['low', 'high']), model('new-model', ['high'])] }],
    [{ provider: 'codex', models: [model('shared', ['low'])] }],
  ])
  expect(result[0]?.models.map((entry) => [entry.id, entry.efforts])).toEqual([['shared', ['low']]])
  expect(intersectCatalogs([])).toEqual([])
  expect(intersectCatalogs([[{ provider: 'codex', models: [model('one', ['low'])] }], []])[0]?.models).toEqual([])
})

it('offers the common range when versions have different numeric limits', () => {
  const fields = commonSettings([
    snapshot({ type: 'integer', minimum: 1, maximum: 8 }),
    snapshot({ type: 'integer', minimum: 3, maximum: 20 }),
  ])
  expect(fields[0]?.schema).toEqual({ type: 'integer', minimum: 3, maximum: 8 })
  expect(
    commonSettings([snapshot({ type: 'integer', maximum: 2 }), snapshot({ type: 'integer', minimum: 3 })]),
  ).toEqual([])
})
