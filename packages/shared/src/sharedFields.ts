// The preference fields the host's shared mobile layer can carry, each with the check an incoming or stored value must
// pass. The host refuses any other field or value, and a client ignores an unreadable stored one, so a newer client can
// add a field without a host or phone misreading it.
import type { PreferenceEntry, PreferenceLayer, PreferenceValue } from './preferenceScopes'

export const SHARED_MOBILE_FIELDS = {
  modelFlow: (value: unknown): value is 'model' | 'effort' => value === 'model' || value === 'effort',
  queueWhileBusy: (value: unknown): value is 'steer' | 'queue' => value === 'steer' || value === 'queue',
  modelChangeWarning: (value: unknown): value is boolean => typeof value === 'boolean',
  recentChatMode: (value: unknown): value is boolean => typeof value === 'boolean',
} as const

export type SharedMobileField = keyof typeof SHARED_MOBILE_FIELDS

export const isSharedMobileField = (id: string): id is SharedMobileField => Object.hasOwn(SHARED_MOBILE_FIELDS, id)

export interface LayerSyncEdit {
  id: SharedMobileField
  /** Absent clears the override. */
  value?: string | boolean
  at: number
  by: string
}

/**
 * What to write to each host so every host holds the newest entry (or cleared marker) for each shared field. The phone
 * is the carrier: hosts never talk to each other, so a person's settings follow their phone across hosts. A host that
 * could not be read (`null`) is left alone, and a host that already holds the newest entry needs nothing.
 */
export function planLayerSync(
  layers: Record<string, PreferenceLayer | null | undefined>,
): Record<string, LayerSyncEdit[]> {
  const plan: Record<string, LayerSyncEdit[]> = {}
  const newer = (a: PreferenceEntry, b: PreferenceEntry) => a.at > b.at || (a.at === b.at && a.by > b.by)
  for (const id of Object.keys(SHARED_MOBILE_FIELDS) as SharedMobileField[]) {
    let best: PreferenceEntry | undefined
    for (const layer of Object.values(layers)) {
      const entry = layer?.fields[id]
      if (entry && (entry.cleared || SHARED_MOBILE_FIELDS[id](entry.value)) && (!best || newer(entry, best)))
        best = entry
    }
    if (!best) continue
    for (const [host, layer] of Object.entries(layers)) {
      if (!layer) continue
      const held = layer.fields[id]
      if (held && !newer(best, held)) continue
      ;(plan[host] ??= []).push({
        id,
        ...(best.cleared ? {} : { value: best.value as string | boolean }),
        at: best.at,
        by: best.by,
      })
    }
  }
  return plan
}

/** A layer's value for a field when it passes that field's check; anything else reads as "not set". */
export function sharedValue(
  layer: PreferenceLayer | null | undefined,
  id: SharedMobileField,
): PreferenceValue | undefined {
  const entry = layer?.fields[id]
  if (entry?.cleared) return undefined
  const value = entry?.value
  return SHARED_MOBILE_FIELDS[id](value) ? (value as PreferenceValue) : undefined
}
