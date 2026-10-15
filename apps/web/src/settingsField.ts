import { createContext, useContext } from 'react'
import type { SettingSchema } from '@ramu/shared/settingsCompatibility'

export const SettingsFieldContext = createContext<{
  path: string
  schema?: SettingSchema
  mixed: boolean
  disabled: boolean
  mark: () => void
} | null>(null)
export const useSettingsField = () => useContext(SettingsFieldContext)
