import { z } from 'zod'
import {
  portableSettings,
  sameValue,
  schemaKey,
  type SettingEdit,
  type SettingsSnapshot,
  type SettingSchema,
} from '@ramu/shared/settingsCompatibility'
import type { AppPreferences, ModelPreferences } from '@ramu/shared/types'
import { applySettingEdits, validateSettingModels } from '../../sharedSettings'
import { appPreferences, modelPreferences } from '../preferences'
import type { RegisterHandlers } from '../types'

/** App preferences (including the portable settings snapshot and patching) and model sets. */
export const registerSettingsHandlers: RegisterHandlers = ({
  host,
  workspace,
  agents,
  loadPreferences,
  savePreferences,
}) => {
  const sharedSettingsSchema = z.toJSONSchema(appPreferences, { unrepresentable: 'any' }) as SettingSchema
  const modelSettingsSchema = z.toJSONSchema(modelPreferences.nullable(), { unrepresentable: 'any' }) as SettingSchema
  const modelSettings = () => workspace.getAppState<ModelPreferences | null>('model-preferences', null)
  const settingsSnapshot = async (): Promise<SettingsSnapshot> => {
    const preferences = loadPreferences(),
      models = modelSettings()
    return {
      protocol: 1,
      preferences,
      models,
      catalogs: agents ? await agents.catalog() : [],
      settings: [
        ...portableSettings(sharedSettingsSchema, preferences as unknown as Record<string, unknown>),
        { path: '$models', schema: modelSettingsSchema, value: models },
      ],
    }
  }

  return {
    'settings.app.get': { args: z.tuple([]), run: loadPreferences },
    'settings.app.snapshot': { args: z.tuple([]), run: settingsSnapshot },
    'settings.app.patch': {
      args: z.tuple([
        z
          .array(
            z.object({
              path: z.string().min(1).max(200),
              schema: z.record(z.string(), z.unknown()),
              before: z.unknown().optional(),
              value: z.unknown().optional(),
            }),
          )
          .min(1)
          .max(200),
      ]),
      run: async (edits: SettingEdit[]) => {
        // Resolve dynamic choices before reading current values; comparison and persistence then stay synchronous.
        const catalogs = agents ? await agents.catalog() : null
        const modelEdits = edits.filter((edit) => edit.path === '$models')
        if (modelEdits.length > 1) throw new Error('Duplicate model settings')
        const modelEdit = modelEdits[0]
        if (modelEdit && schemaKey(modelEdit.schema) !== schemaKey(modelSettingsSchema))
          throw new Error('Model options changed. Reload before saving.')
        if (modelEdit && !sameValue(modelSettings(), modelEdit.before) && !sameValue(modelSettings(), modelEdit.value))
          throw new Error('Model sets changed elsewhere. Reload before saving.')
        const models = modelEdit ? modelPreferences.parse(modelEdit.value) : undefined
        const preferences = applySettingEdits(
          sharedSettingsSchema,
          appPreferences,
          loadPreferences(),
          edits.filter((edit) => edit.path !== '$models'),
        )
        for (const edit of edits) {
          const match = /^providerBinaries\.([^.]+)\.(accountId|accounts)$/.exec(edit.path)
          if (!match) continue
          const config = (
            preferences.providerBinaries as Record<
              string,
              { accountId?: string; accounts?: { id: string; enabled?: boolean }[] }
            >
          )[match[1]!]
          if (
            config?.accountId &&
            config.accountId !== 'default' &&
            !config.accounts?.some((account) => account.id === config.accountId && account.enabled !== false)
          )
            throw new Error('Provider account options changed. Reload before saving.')
        }
        if (catalogs) validateSettingModels(edits, catalogs)
        if (models) {
          workspace.setAppState('model-preferences', models)
          host.send('settings:models', models)
        }
        savePreferences(preferences)
        return settingsSnapshot()
      },
    },
    'settings.app.set': {
      args: z.tuple([appPreferences]),
      run: (preferences: AppPreferences) => savePreferences(preferences),
    },
    'settings.models.get': {
      args: z.tuple([]),
      run: (): ModelPreferences | null => {
        const saved = workspace.getAppState<
          (Omit<ModelPreferences, 'defaultBarMode'> & { defaultBarMode?: string }) | null
        >('model-preferences', null)
        return saved ? { ...saved, defaultBarMode: saved.defaultBarMode === 'effort' ? 'effort' : 'model' } : null
      },
    },
    'settings.models.set': {
      args: z.tuple([modelPreferences]),
      run: (preferences: ModelPreferences) => {
        workspace.setAppState('model-preferences', preferences)
        host.send('settings:models', preferences)
      },
    },
  }
}
