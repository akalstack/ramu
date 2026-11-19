import type { SettingsMenuId } from './settingsMenu'

/** One setting an agent asked to change, as its card shows it: the row, its page, and the value before and after. */
export interface SettingsChangeRow {
  path: string
  /** The row's title, an English copy key. */
  title: string
  section: SettingsMenuId
  before: unknown
  value: unknown
}

/**
 * Settings an agent asked to change in one call. Ask modes wait for the person's Apply; Full access applies at once and
 * offers Undo, which is refused once the person has changed one of the rows since.
 */
export interface SettingsChangeCard {
  id: string
  sessionId: string
  taskId: string
  /** The agent's one-line reason, shown on the card. */
  reason: string
  rows: SettingsChangeRow[]
  state: 'waiting' | 'applied' | 'dismissed' | 'undone'
  /** Why the last Apply or Undo was refused; the card offers Open in Settings beside it. */
  error?: string
  createdAt: number
}

/** A value as a person reads it, from its type alone: On, Off, a choice, a count, a model, or Custom. */
export function readableSettingValue(value: unknown, translate: (text: string) => string): string {
  if (value === null || value === undefined) return translate('Not set')
  if (typeof value === 'boolean') return translate(value ? 'On' : 'Off')
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    if (!value) return translate('Empty')
    return value.length > 80 ? `${value.slice(0, 79)}…` : value
  }
  if (Array.isArray(value))
    return translate(value.length === 1 ? '1 item' : '{0} items').replace('{0}', String(value.length))
  if (typeof value === 'object' && typeof (value as { model?: unknown }).model === 'string')
    return (value as { model: string }).model || translate('Default model')
  return translate('Custom')
}
