import { expect, it } from 'vitest'
import { z } from 'zod'
import { portableSettings, type SettingEdit, type SettingSchema } from '@ramu/shared/settingsCompatibility'
import { appPreferences } from '../src/ipc/preferences'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import { applySettingEdits, validateSettingModels } from '../src/sharedSettings'

const validator = z.object({
  accent: z.enum(['blue', 'teal']),
  memory: z.object({ enabled: z.boolean(), days: z.number().int().min(7) }),
  models: z.array(z.string()).max(3),
})
const schema = z.toJSONSchema(validator) as SettingSchema
const current = { accent: 'blue' as const, memory: { enabled: true, days: 90 }, models: ['local'] }
const edit = (path: string, value: unknown): SettingEdit => {
  const field = portableSettings(schema, current).find((field) => field.path === path)!
  return { path, before: field.value, schema: field.schema, value }
}

it('patches only selected fields and preserves other nested and list values', () => {
  expect(applySettingEdits(schema, validator, current, [edit('memory.enabled', false)])).toEqual({
    ...current,
    memory: { ...current.memory, enabled: false },
  })
  expect(current.memory.enabled).toBe(true)
})
it('rejects a concurrent edit without losing unrelated settings', () => {
  expect(() =>
    applySettingEdits(schema, validator, { ...current, memory: { ...current.memory, days: 30 } }, [
      edit('memory.days', 60),
    ]),
  ).toThrow(/changed elsewhere/)
  expect(applySettingEdits(schema, validator, { ...current, models: [] }, [edit('memory.days', 60)]).models).toEqual([])
})
it('rejects changed server options even if the requested value is still valid', () => {
  const change = edit('accent', 'teal')
  change.schema = { type: 'string', enum: ['blue', 'teal', 'violet'] }
  expect(() => applySettingEdits(schema, validator, current, [change])).toThrow(/options changed/)
})
it('validates every edit before persisting a batch', () => {
  expect(() =>
    applySettingEdits(schema, validator, current, [edit('accent', 'teal'), edit('memory.days', 1)]),
  ).toThrow()
  expect(current.accent).toBe('blue')
  expect(() => applySettingEdits(schema, validator, current, [edit('models', ['a', 'b', 'c', 'd'])])).toThrow()
})
it('safely accepts a retry after the original save succeeded', () => {
  expect(applySettingEdits(schema, validator, { ...current, accent: 'teal' }, [edit('accent', 'teal')]).accent).toBe(
    'teal',
  )
})
it('rejects unknown paths, prototype traversal and duplicate edits', () => {
  for (const path of ['__proto__.polluted', 'memory.constructor.prototype', 'providerBinaries', 'unknown']) {
    expect(() =>
      applySettingEdits(schema, validator, current, [{ path, before: null, schema: {}, value: true }]),
    ).toThrow(/Unsupported/)
  }
  expect(() => applySettingEdits(schema, validator, current, [edit('accent', 'teal'), edit('accent', 'blue')])).toThrow(
    /Unsupported/,
  )
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
})

it('patches optional provider fields and structured lists without replacing sibling configuration', () => {
  const validator = z.object({
    providers: z.object({
      codex: z
        .object({
          binary: z.string(),
          enabled: z.boolean().optional(),
          accounts: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
        })
        .optional(),
    }),
  })
  const schema = z.toJSONSchema(validator) as SettingSchema
  const current = { providers: {} }
  const fields = portableSettings(schema, current)
  const patch = (path: string, value: unknown): SettingEdit => ({
    path,
    schema: fields.find((field) => field.path === path)!.schema,
    before: undefined,
    value,
  })
  const edits = [
    patch('providers.codex.binary', '/opt/codex'),
    patch('providers.codex.accounts', [{ id: 'work', name: 'Work' }]),
  ]
  // Match the JSON wire format: absent optional values do not serialize.
  expect(applySettingEdits(schema, validator, current, JSON.parse(JSON.stringify(edits)))).toEqual({
    providers: { codex: { binary: '/opt/codex', accounts: [{ id: 'work', name: 'Work' }] } },
  })
})

it('rechecks model and effort choices while preserving existing unavailable configurations', () => {
  const catalog: import('@ramu/shared/types').ProviderCatalog[] = [
    {
      provider: 'codex',
      models: [
        { provider: 'codex', id: 'shared', name: 'Shared', efforts: ['low'], defaultEffort: 'low', isDefault: true },
      ],
    },
  ]
  const change = (value: unknown, before: unknown = null): SettingEdit[] => [
    { path: '$models', schema: {}, before, value },
  ]
  expect(() =>
    validateSettingModels(change({ provider: 'codex', model: 'shared', effort: 'low' }), catalog),
  ).not.toThrow()
  expect(() => validateSettingModels(change({ provider: 'codex', model: 'shared', effort: 'high' }), catalog)).toThrow(
    /Model options changed/,
  )
  expect(() => validateSettingModels(change({ provider: 'codex', model: 'removed', effort: null }), catalog)).toThrow(
    /Model options changed/,
  )
  const old = { provider: 'codex', model: 'removed', effort: null }
  expect(() => validateSettingModels(change(old, old), catalog)).not.toThrow()
})

it('advertises individual optional browser overrides and clears one without replacing the host default or siblings', () => {
  const validator = appPreferences
  const schema = z.toJSONSchema(validator, { unrepresentable: 'any' }) as SettingSchema
  const saved = validator.parse({
    ...DEFAULT_APP_PREFERENCES,
    agentBrowser: {
      agentBrowser: 'integrated',
      defaultProfileId: 'temporary',
      providerOverrides: { codex: 'provider', cursor: 'integrated' },
    },
  })
  const field = portableSettings(schema, saved).find((entry) => entry.path === 'agentBrowser.providerOverrides.codex')!
  expect(field).toBeDefined()
  const cleared = applySettingEdits(schema, validator, saved, [
    { path: field.path, schema: field.schema, before: field.value, value: undefined },
  ])
  expect(cleared.agentBrowser).toEqual({
    agentBrowser: 'integrated',
    defaultProfileId: 'temporary',
    providerOverrides: { cursor: 'integrated' },
  })
})
