import { AGENT_PROVIDERS } from '@ramu/shared/providers/providers'
import { DEFAULT_APP_PREFERENCES, DEFAULT_INTELLIGENCE_PREFERENCES, type AppPreferences } from '@ramu/shared/types'
import type { SettingsSection } from './SettingsPage'
import { CHATS_INTELLIGENCE_KEYS, MEMORY_INTELLIGENCE_KEYS, MODELS_INTELLIGENCE_KEYS, RESET_KEYS } from './constants'

function intelligenceKeys(section: SettingsSection): readonly (keyof AppPreferences['intelligence'])[] {
  if (section === 'chats') return CHATS_INTELLIGENCE_KEYS
  if (section === 'memory') return MEMORY_INTELLIGENCE_KEYS
  return section === 'models' ? MODELS_INTELLIGENCE_KEYS : []
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
              },
            ]),
          ),
        }
      : {}),
  }
}
