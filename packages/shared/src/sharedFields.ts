// The preference fields the host's shared mobile layer can carry, each with the check an incoming or stored value must
// pass. The host refuses any other field or value, and a client ignores an unreadable stored one, so a newer client can
// add a field without an older host or phone misreading it.
import type { PreferenceLayer, PreferenceValue } from './preferenceScopes'

export const SHARED_MOBILE_FIELDS = {
  modelFlow: (value: unknown): value is 'model' | 'effort' => value === 'model' || value === 'effort',
  queueWhileBusy: (value: unknown): value is 'steer' | 'queue' => value === 'steer' || value === 'queue',
  modelChangeWarning: (value: unknown): value is boolean => typeof value === 'boolean',
} as const

export type SharedMobileField = keyof typeof SHARED_MOBILE_FIELDS

export const isSharedMobileField = (id: string): id is SharedMobileField => Object.hasOwn(SHARED_MOBILE_FIELDS, id)

/** A layer's value for a field when it passes that field's check; anything else reads as "not set". */
export function sharedValue(
  layer: PreferenceLayer | null | undefined,
  id: SharedMobileField,
): PreferenceValue | undefined {
  const value = layer?.fields[id]?.value
  return SHARED_MOBILE_FIELDS[id](value) ? (value as PreferenceValue) : undefined
}
