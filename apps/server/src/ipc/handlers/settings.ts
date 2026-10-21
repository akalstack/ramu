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
import { migrateModelDefaults, recommendedSets } from '@ramu/shared/providers/modelDefaults'
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
  diagnostics,
}) => {
  const sharedSettingsSchema = z.toJSONSchema(appPreferences, { unrepresentable: 'any' }) as SettingSchema
  const modelSettingsSchema = z.toJSONSchema(modelPreferences.nullable(), { unrepresentable: 'any' }) as SettingSchema
  const selectionMode = z.enum(['model', 'effort'])
  const selectionModeSchema = z.toJSONSchema(selectionMode) as SettingSchema
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
        { path: '$models.defaultBarMode', schema: selectionModeSchema, value: models?.defaultBarMode ?? 'model' },
      ],
    }
  }

  return {
    'settings.permissions.clear': {
      args: z.tuple([
        z
          .object({ scope: z.enum(['user', 'project', 'projects', 'all']), projectId: z.string().optional() })
          .optional(),
      ]),
      run: (removal) => agents.clearPermissionApprovals(removal),
    },
    'settings.permissions.list': { args: z.tuple([]), run: () => agents.listPermissionApprovals() },
    'settings.permissions.remove': {
      args: z.tuple([z.string().max(2000)]),
      run: (id) => agents.removePermissionApproval(id),
    },
    'onboarding.get': {
      args: z.tuple([]),
      run: () => ({
        needed:
          !workspace.getAppState('onboarding-completed', false) &&
          workspace.listProjects().length === 0 &&
          (process.env.RAMU_FAKE_AGENT !== '1' || process.env.RAMU_E2E_ONBOARDING === '1'),
      }),
    },
    'onboarding.complete': { args: z.tuple([]), run: () => workspace.setAppState('onboarding-completed', true) },
    'diagnostics.export': { args: z.tuple([]), run: () => diagnostics?.export() ?? '{}' },
    'diagnostics.clear': { args: z.tuple([]), run: () => diagnostics?.clear() },
    'diagnostics.nativeEvent': {
      args: z.tuple([z.enum(['renderer-crash', 'desktop-crash'])]),
      run: (kind: 'renderer-crash' | 'desktop-crash') => diagnostics?.record(kind),
    },
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
        const modelEdits = edits.filter((edit) => edit.path === '$models' || edit.path === '$models.defaultBarMode')
        if (modelEdits.length > 1) throw new Error('Duplicate model settings')
        const modeEdit = modelEdits.find((edit) => edit.path === '$models.defaultBarMode')
        const modelEdit = modelEdits.find((edit) => edit.path === '$models')
        if (modelEdit && schemaKey(modelEdit.schema) !== schemaKey(modelSettingsSchema))
          throw new Error('Model options changed. Reload before saving.')
        if (modelEdit && !sameValue(modelSettings(), modelEdit.before) && !sameValue(modelSettings(), modelEdit.value))
          throw new Error('Model sets changed elsewhere. Reload before saving.')
        if (modeEdit && schemaKey(modeEdit.schema) !== schemaKey(selectionModeSchema))
          throw new Error('Model selection options changed. Reload before saving.')
        const currentMode = modelSettings()?.defaultBarMode ?? 'model'
        if (modeEdit && !sameValue(currentMode, modeEdit.before) && !sameValue(currentMode, modeEdit.value))
          throw new Error('Model selection changed elsewhere. Reload before saving.')
        const models = modelEdit
          ? modelPreferences.parse(modelEdit.value)
          : modeEdit
            ? modelPreferences.parse({
                ...(modelSettings() ?? recommendedSets(catalogs ?? [])),
                defaultBarMode: selectionMode.parse(modeEdit.value),
              })
            : undefined
        const stored = loadPreferences()
        const preferences = applySettingEdits(
          sharedSettingsSchema,
          appPreferences,
          { ...stored, agentBrowser: stored.agentBrowser ?? appPreferences.shape.agentBrowser.parse(undefined) },
          edits.filter((edit) => edit.path !== '$models' && edit.path !== '$models.defaultBarMode'),
        )
        for (const edit of edits) {
          const match = /^providerBinaries\.([^.]+)\.(accountId|accounts|accountOrder|defaultAccountEnabled)$/.exec(
            edit.path,
          )
          if (!match) continue
          const config = (
            preferences.providerBinaries as Record<
              string,
              {
                accountId?: string
                accounts?: { id: string; enabled?: boolean }[]
                defaultAccountEnabled?: boolean
              }
            >
          )[match[1]!]
          if (
            config &&
            config.defaultAccountEnabled === false &&
            !config.accounts?.some((account) => account.enabled !== false)
          )
            throw new Error('Keep at least one login turned on.')
          if (
            config?.accountId &&
            config.accountId !== 'default' &&
            !config.accounts?.some((account) => account.id === config.accountId && account.enabled !== false)
          )
            throw new Error('Provider account options changed. Reload before saving.')
        }
        if (catalogs) validateSettingModels(edits, catalogs)
        savePreferences(preferences, models)
        return settingsSnapshot()
      },
    },
    'settings.app.set': {
      args: z.tuple([appPreferences]),
      run: (preferences: AppPreferences) => savePreferences(preferences),
    },
    'settings.models.get': {
      args: z.tuple([]),
      run: async (): Promise<ModelPreferences> => {
        const catalogs = agents ? await agents.catalog() : []
        const saved = workspace.getAppState<
          (Omit<ModelPreferences, 'defaultBarMode'> & { defaultBarMode?: string }) | null
        >('model-preferences', null)
        const defaults = recommendedSets(catalogs)
        if (!saved) return defaults
        const normalized = {
          ...saved,
          defaultBarMode: saved.defaultBarMode === 'effort' ? ('effort' as const) : ('model' as const),
        }
        const updated = migrateModelDefaults(normalized, defaults)
        if (updated !== normalized) {
          workspace.setAppState('model-preferences', updated)
          host.send('settings:models', updated)
        }
        return updated
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
