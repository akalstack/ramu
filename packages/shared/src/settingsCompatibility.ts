import type { AppPreferences, ModelPreferences, ProviderCatalog } from './types'
/** A server advertises its actual setting constraints, independently of its app version. */
export interface SettingSchema {
  type?: string
  enum?: unknown[]
  const?: unknown
  properties?: Record<string, SettingSchema>
  items?: SettingSchema
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  pattern?: string
  [key: string]: unknown
}
export interface SharedSetting {
  path: string
  schema: SettingSchema
  value: unknown
}
export interface SettingsSnapshot {
  protocol: 1
  settings: SharedSetting[]
  preferences?: AppPreferences
  models?: ModelPreferences | null
  catalogs?: ProviderCatalog[]
}
export interface SettingEdit {
  path: string
  schema: SettingSchema
  before: unknown
  value: unknown
}

/** Ignore presentation/default annotations; preserve every validation constraint. */
export function schemaKey(value: unknown): string {
  const normalize = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([key]) => !['default', 'description', 'title', '$schema'].includes(key))
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, entry]) => [key, normalize(entry)]),
          )
        : value
  return JSON.stringify(normalize(value))
}
export const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Advertise every editable setting, including structured lists and optional provider configuration. */
export function portableSettings(
  schema: SettingSchema,
  preferences: Record<string, unknown>,
  prefix = '',
): SharedSetting[] {
  return Object.entries(schema.properties ?? {}).flatMap(([key, field]) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) return []
    const path = prefix ? `${prefix}.${key}` : key
    const value = preferences[key]
    if (field.type === 'object' && field.properties)
      return portableSettings(field, (value ?? {}) as Record<string, unknown>, path)
    if (
      field.type === 'object' &&
      field.additionalProperties &&
      typeof field.additionalProperties === 'object' &&
      (field.propertyNames as SettingSchema | undefined)?.enum
    ) {
      const keys = (field.propertyNames as SettingSchema).enum!.filter(
        (entry): entry is string => typeof entry === 'string',
      )
      return portableSettings(
        { properties: Object.fromEntries(keys.map((key) => [key, field.additionalProperties as SettingSchema])) },
        (value ?? {}) as Record<string, unknown>,
        path,
      )
    }
    if (field.const !== undefined) return []
    return [{ path, schema: field, value }]
  })
}

/** Different option lists are compatible only for choices every target accepts. */
export function commonSettings(snapshots: SettingsSnapshot[]): SharedSetting[] {
  if (!snapshots.length) return []
  return snapshots[0]!.settings.flatMap((first) => {
    const fields = snapshots.map((snapshot) => snapshot.settings.find((field) => field.path === first.path))
    if (fields.some((field) => !field || field.schema.type !== first.schema.type)) return []
    const schemas = fields.map((field) => field!.schema)
    const ranges = [
      ['minimum', 'maximum'],
      ['minLength', 'maxLength'],
      ['minItems', 'maxItems'],
    ] as const
    const stripOptions = (schema: SettingSchema) =>
      Object.fromEntries(
        Object.entries(schema).filter(
          ([key]) => key !== 'enum' && !ranges.some(([lower, upper]) => key === lower || key === upper),
        ),
      )
    if (schemas.some((schema) => schemaKey(stripOptions(schema)) !== schemaKey(stripOptions(first.schema)))) return []
    const shared = { ...first.schema }
    for (const [lower, upper] of ranges) {
      const minimum = Math.max(
        ...schemas.map((schema) => (typeof schema[lower] === 'number' ? (schema[lower] as number) : -Infinity)),
      )
      const maximum = Math.min(
        ...schemas.map((schema) => (typeof schema[upper] === 'number' ? (schema[upper] as number) : Infinity)),
      )
      if (minimum > maximum) return []
      if (Number.isFinite(minimum)) shared[lower] = minimum
      if (Number.isFinite(maximum)) shared[upper] = maximum
    }
    if (schemas.some((schema) => schema.enum)) {
      const options = schemas
        .find((schema) => schema.enum)!
        .enum!.filter((value) =>
          schemas.every((schema) => !schema.enum || schema.enum.some((option) => sameValue(option, value))),
        )
      return options.length ? [{ ...first, schema: { ...shared, enum: options } }] : []
    }
    return [{ ...first, schema: shared }]
  })
}

export function settingValue(preferences: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined),
      preferences,
    )
}
export function setSettingValue(preferences: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.')
  let parent = preferences
  for (const key of keys.slice(0, -1)) {
    if (!parent[key] || typeof parent[key] !== 'object') parent[key] = {}
    parent = parent[key] as Record<string, unknown>
  }
  if (value === undefined) delete parent[keys.at(-1)!]
  else parent[keys.at(-1)!] = value
}

export function intersectCatalogs(catalogs: ProviderCatalog[][]): ProviderCatalog[] {
  if (!catalogs.length) return []
  return catalogs[0]!.map((catalog) => ({
    ...catalog,
    models: catalog.models.flatMap((model) => {
      const matches = catalogs.map((list) =>
        list
          .flatMap((entry) => entry.models)
          .find((entry) => entry.provider === model.provider && entry.id === model.id),
      )
      if (matches.some((entry) => !entry)) return []
      return [
        {
          ...model,
          efforts: model.efforts.filter((effort) => matches.every((entry) => entry!.efforts.includes(effort))),
        },
      ]
    }),
  }))
}
