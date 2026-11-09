import { AGENT_PROVIDERS } from '@ramu/shared/providers/providers'
import { setSettingValue, type SettingSchema } from '@ramu/shared/settingsCompatibility'
import { DEFAULT_APP_PREFERENCES, DEFAULT_INTELLIGENCE_PREFERENCES, type AppPreferences } from '@ramu/shared/types'
import type { SettingsSection } from './SettingsPage'
import { CHATS_INTELLIGENCE_KEYS, MEMORY_INTELLIGENCE_KEYS, RESET_KEYS } from './constants'

function intelligenceKeys(section: SettingsSection): readonly (keyof AppPreferences['intelligence'])[] {
  return section === 'chats' ? CHATS_INTELLIGENCE_KEYS : section === 'memory' ? MEMORY_INTELLIGENCE_KEYS : []
}

// Whether a setting path belongs to the section being reset.
export function inResetSection(section: SettingsSection, path: string) {
  const keys = RESET_KEYS[section] ?? []
  return (
    keys.some((key) => path === key || path.startsWith(`${key}.`)) ||
    intelligenceKeys(section).some((key) => path === `intelligence.${key}`)
  )
}

export function resetSection(current: AppPreferences, section: SettingsSection): AppPreferences {
  const keys = RESET_KEYS[section] ?? []
  const D = DEFAULT_INTELLIGENCE_PREFERENCES
  const owned = intelligenceKeys(section)
  return {
    ...current,
    ...Object.fromEntries(keys.map((key) => [key, DEFAULT_APP_PREFERENCES[key]])),
    intelligence: owned.length
      ? { ...current.intelligence, ...Object.fromEntries(owned.map((key) => [key, D[key]])) }
      : current.intelligence,
    // Account identities are recovery metadata, not disposable appearance settings.
    ...(section === 'providers'
      ? {
          providerBinaries: Object.fromEntries(
            AGENT_PROVIDERS.map((provider) => [
              provider,
              {
                ...current.providerBinaries[provider],
                binary: '',
                accountId: 'default',
                autoUpdate: false,
                enabled: true,
                harness: '',
              },
            ]),
          ),
        }
      : {}),
  }
}

/** The draft with one setting put back to the default its host advertises; unchanged when it names none. */
export function resetSetting(current: AppPreferences, path: string, schema: SettingSchema | undefined): AppPreferences {
  if (schema?.default === undefined) return current
  const next = structuredClone(current)
  setSettingValue(next as unknown as Record<string, unknown>, path, structuredClone(schema.default))
  return next
}
