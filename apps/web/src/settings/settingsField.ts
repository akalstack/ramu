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

/**
 * Opens a thread of this computer from Settings, keeping Settings open beneath when it has unsaved changes; `has` says
 * whether the thread is on this computer. Absent outside the Settings panel.
 */
export const SettingsThreadContext = createContext<{
  open: (taskId: string) => void
  has: (taskId: string) => boolean
} | null>(null)
