import { expect, it } from 'vitest'
import { z } from 'zod'
import { portableSettings, type SettingSchema } from '@ramu/shared/settingsCompatibility'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import { appPreferences } from '../src/ipc/preferences'

it('offers the writing and background models as single settings, so the phone can choose them', () => {
  const schema = z.toJSONSchema(appPreferences, { unrepresentable: 'any' }) as SettingSchema
  const paths = portableSettings(schema, DEFAULT_APP_PREFERENCES as unknown as Record<string, unknown>).map(
    (setting) => setting.path,
  )
  expect(paths).toContain('commitModel')
  expect(paths).toContain('intelligence.maintenanceModel')
  expect(paths).toContain('modelCatalogLookups')
  expect(paths).toContain('hostDescription')
})
