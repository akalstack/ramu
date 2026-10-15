import type { z } from 'zod'
import { portableSettings, sameValue, schemaKey, setSettingValue, type SettingEdit, type SettingSchema } from '@ramu/shared/settingsCompatibility'

/** Validate the whole batch before returning anything that can be persisted. */
export function applySettingEdits<T extends Record<string, unknown>>(schema: SettingSchema, validator: z.ZodType<T>, current: T, edits: SettingEdit[]): T {
  const fields = new Map(portableSettings(schema, current).map((field) => [field.path, field]))
  const next = structuredClone(current)
  const seen = new Set<string>()
  for (const edit of edits) {
    const field = fields.get(edit.path)
    if (!field || seen.has(edit.path)) throw new Error(`Unsupported setting: ${edit.path}`)
    seen.add(edit.path)
    if (schemaKey(field.schema) !== schemaKey(edit.schema)) throw new Error(`Setting options changed: ${edit.path}. Reload before saving.`)
    // A retry after a lost acknowledgement is safe when the requested value is already saved.
    if (!sameValue(field.value, edit.before) && !sameValue(field.value, edit.value)) throw new Error(`Setting changed elsewhere: ${edit.path}. Reload before saving.`)
    setSettingValue(next, edit.path, edit.value)
  }
  return validator.parse(next)
}

/** Catalogs can change between opening Settings and saving, independently of the schema. */
export function validateSettingModels(edits: SettingEdit[], catalogs: import('@ramu/shared/types').ProviderCatalog[]) {
  const references = (value: unknown): { provider: string; model: string; effort?: string | null }[] => {
    if (!value || typeof value !== 'object') return []
    if (Array.isArray(value)) return value.flatMap(references)
    const object = value as Record<string, unknown>
    if (typeof object.provider === 'string' && typeof object.model === 'string') return [object as { provider: string; model: string; effort?: string | null }]
    return Object.values(object).flatMap(references)
  }
  for (const edit of edits) {
    const previous = references(edit.before)
    for (const reference of references(edit.value)) {
      if (previous.some((entry) => entry.provider === reference.provider && entry.model === reference.model && entry.effort === reference.effort)) continue
      const model = catalogs.flatMap((catalog) => catalog.models).find((model) => model.provider === reference.provider && (model.id === reference.model || !reference.model && model.isDefault))
      if (!model || reference.effort && !model.efforts.includes(reference.effort as import('@ramu/shared/types').ReasoningEffort)) throw new Error(`Model options changed: ${reference.model || reference.provider}. Reload before saving.`)
    }
  }
}
