import { expect, it } from 'vitest'
import {
  PERSON_ONLY,
  commonSettings,
  defaultEdits,
  differsFromDefault,
  intersectCatalogs,
  portableSettings,
  schemaKey,
  type SettingsSnapshot,
  type SettingSchema,
} from '../src/settingsCompatibility'

const snapshot = (schema: SettingSchema, value: unknown = 'blue'): SettingsSnapshot => ({
  protocol: 1,
  settings: [{ path: 'accent', schema, value, agentMayChange: true }],
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
it('advertises provider configuration and complex lists ', () => {
  const schema: SettingSchema = {
    properties: {
      accent: { type: 'string' },
      memory: { type: 'object', properties: { enabled: { type: 'boolean' } } },
      providerBinaries: { type: 'object', properties: { binary: { type: 'string' } } },
      favoriteModels: { type: 'array', items: { type: 'string' } },
      steps: { type: 'array', items: { type: 'object' } },
    },
  }
  expect(
    portableSettings(schema, {
      accent: 'blue',
      memory: { enabled: true },
      providerBinaries: { binary: '/secret' },
      favoriteModels: [],
      steps: [],
    }).map((field) => field.path),
  ).toEqual(['accent', 'memory.enabled', 'providerBinaries.binary', 'favoriteModels', 'steps'])
})

it('intersects model catalogs and reasoning efforts across independently updated hosts', () => {
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

it('marks settings only the person may change, including every setting in a marked group', () => {
  const fields = portableSettings(
    {
      properties: {
        accent: { type: 'string', enum: ['blue', 'teal'] },
        defaultAccess: { type: 'string', enum: ['edits', 'full'], [PERSON_ONLY]: true },
        abilities: {
          type: 'object',
          properties: {
            choice: { type: 'string' },
            autoMcp: { type: 'object', [PERSON_ONLY]: true, properties: { tool: { type: 'string' } } },
          },
        },
      },
    },
    {},
  )
  expect(Object.fromEntries(fields.map((field) => [field.path, field.agentMayChange]))).toEqual({
    accent: true,
    defaultAccess: false,
    'abilities.choice': true,
    'abilities.autoMcp.tool': false,
  })
})

it('leaves the person-only mark out of schema compatibility', () => {
  expect(schemaKey({ type: 'boolean', [PERSON_ONLY]: true })).toBe(schemaKey({ type: 'boolean' }))
})

it('tells a changed setting from its advertised default, and leaves rows without one alone', () => {
  const schema: SettingSchema = { type: 'number', default: 60 }
  expect(differsFromDefault({ schema }, 30)).toBe(true)
  expect(differsFromDefault({ schema }, 60)).toBe(false)
  // Unset follows the default; a schema with no default has nothing to differ from.
  expect(differsFromDefault({ schema }, undefined)).toBe(false)
  expect(differsFromDefault({ schema: { type: 'number' } }, 30)).toBe(false)
  expect(differsFromDefault(undefined, 30)).toBe(false)
  expect(differsFromDefault({ schema: { type: 'object', default: { a: 1 } } }, { a: 1 })).toBe(false)
})

it('puts back only the defaults of the rows that differ', () => {
  const settings = [
    { path: 'a', schema: { type: 'number', default: 1 }, value: 2, agentMayChange: true },
    { path: 'b', schema: { type: 'number', default: 1 }, value: 1, agentMayChange: true },
    { path: 'c', schema: { type: 'number' }, value: 5, agentMayChange: true },
    { path: 'd', schema: { type: 'array', default: ['x'] }, value: [], agentMayChange: true },
  ]
  const read = (path: string) => settings.find((setting) => setting.path === path)?.value
  const edits = defaultEdits(settings, ['a', 'b', 'c', 'd', 'missing'], read)
  expect(edits).toEqual([
    ['a', 1],
    ['d', ['x']],
  ])
  // The default is copied, so editing the result never changes the advertised schema.
  ;(edits[1]![1] as string[]).push('y')
  expect(settings[3]!.schema.default).toEqual(['x'])
})
