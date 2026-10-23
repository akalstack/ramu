// Shared resolver for per-field preference scopes: a device override beats a mobile override, which beats the
// all-device baseline. Each field carries its own revision so concurrent edits to different fields never replace each
// other, and a stale write to the same field is discarded instead of winning by arrival order.

export type PreferenceScope = 'device' | 'mobile' | 'all'
export type PreferenceSource = PreferenceScope | 'default'
export type DeviceKind = 'phone' | 'tablet' | 'desktop' | 'unknown'

export const PREFERENCE_VERSION = 1

export type PreferenceValue = string | number | boolean | string[] | null

export interface PreferenceEntry {
  value: PreferenceValue
  /** Milliseconds since epoch at the time of the edit; the newer entry wins when layers are merged. */
  at: number
  /** Breaks ties between edits made in the same millisecond. */
  by: string
}

/** One scope's overrides. Fields this client does not know are carried through untouched. */
export interface PreferenceLayer {
  v: number
  fields: Record<string, PreferenceEntry>
}

export interface PreferenceLayers {
  all: PreferenceLayer
  mobile: PreferenceLayer
  device: PreferenceLayer
}

export interface PreferenceField {
  id: string
  /** Scopes that make sense for this field. Hardware and execution settings are never listed here. */
  scopes: PreferenceScope[]
  fallback: PreferenceValue
}

export const PREFERENCE_FIELDS = [
  { id: 'appearance', scopes: ['all', 'mobile', 'device'], fallback: 'system' },
  { id: 'accent', scopes: ['all', 'mobile', 'device'], fallback: null },
  { id: 'language', scopes: ['all', 'mobile', 'device'], fallback: null },
  { id: 'textSize', scopes: ['mobile', 'device'], fallback: 'default' },
  { id: 'reducedMotion', scopes: ['all', 'mobile', 'device'], fallback: 'system' },
  { id: 'modelFlow', scopes: ['all', 'mobile', 'device'], fallback: null },
  { id: 'modelDefault', scopes: ['all', 'mobile', 'device'], fallback: null },
  { id: 'favoriteModels', scopes: ['all', 'mobile', 'device'], fallback: [] },
  { id: 'queueWhileBusy', scopes: ['all', 'mobile', 'device'], fallback: null },
  { id: 'modelChangeWarning', scopes: ['all', 'mobile', 'device'], fallback: true },
  { id: 'notifyCompletion', scopes: ['all', 'mobile', 'device'], fallback: true },
  { id: 'notifyInput', scopes: ['all', 'mobile', 'device'], fallback: true },
  { id: 'notifyFailure', scopes: ['all', 'mobile', 'device'], fallback: true },
] as const satisfies readonly PreferenceField[]

export type PreferenceFieldId = (typeof PREFERENCE_FIELDS)[number]['id']

export const emptyLayer = (): PreferenceLayer => ({ v: PREFERENCE_VERSION, fields: {} })
export const emptyLayers = (): PreferenceLayers => ({ all: emptyLayer(), mobile: emptyLayer(), device: emptyLayer() })

export const fieldById = (id: string): PreferenceField | undefined => PREFERENCE_FIELDS.find((f) => f.id === id)

const ORDER: PreferenceScope[] = ['device', 'mobile', 'all']

export interface ResolvedPreference {
  value: PreferenceValue
  source: PreferenceSource
}

/** Device override, then mobile override, then the all-device baseline, then the field's built-in default. */
export function resolvePreference(layers: PreferenceLayers, id: string): ResolvedPreference {
  for (const scope of ORDER) {
    const entry = layers[scope].fields[id]
    if (entry) return { value: entry.value, source: scope }
  }
  return { value: fieldById(id)?.fallback ?? null, source: 'default' }
}

/** What the person would get after removing the override at `scope`, shown before they confirm. */
export function inheritedPreview(layers: PreferenceLayers, id: string, scope: PreferenceScope): ResolvedPreference {
  const rest: PreferenceLayers = {
    ...layers,
    [scope]: { ...layers[scope], fields: withoutKey(layers[scope].fields, id) },
  }
  return resolvePreference(rest, id)
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record
  return rest
}

/** Scopes this device can offer for a field; `available` lists scopes with a working transport. */
export function offeredScopes(
  id: string,
  kind: DeviceKind,
  /** `shared`: a transport follows the person across devices. `mobile`: the paired host holds the all-mobile layer. */
  available: { shared: boolean; mobile?: boolean },
): { scope: PreferenceScope; enabled: boolean; reason?: string }[] {
  const field = fieldById(id)
  if (!field) return []
  const mobile = kind === 'phone' || kind === 'tablet' || kind === 'unknown'
  return ORDER.filter((scope) => field.scopes.some((s) => s === scope))
    .filter((scope) => (scope === 'mobile' ? mobile : true))
    .map((scope) =>
      scope !== 'device' && !(scope === 'mobile' ? (available.mobile ?? available.shared) : available.shared)
        ? { scope, enabled: false, reason: 'Needs a paired device or account that syncs preferences.' }
        : { scope, enabled: true },
    )
}

export function scopeLabel(scope: PreferenceScope, kind: DeviceKind): string {
  if (scope === 'all') return 'All devices'
  if (scope === 'mobile') return 'All mobile devices'
  return kind === 'phone' ? 'This phone' : kind === 'tablet' ? 'This tablet' : 'This device'
}

export function sourceLabel(source: PreferenceSource, kind: DeviceKind): string {
  if (source === 'all') return 'Using all-device setting'
  if (source === 'mobile') return 'Using mobile setting'
  if (source === 'device') return `Set on ${scopeLabel('device', kind).replace(/^This /, 'this ')}`
  return 'Using built-in default'
}

export function setOverride(
  layers: PreferenceLayers,
  scope: PreferenceScope,
  id: string,
  value: PreferenceValue,
  editor: string,
  now: number,
): PreferenceLayers {
  const field = fieldById(id)
  if (!field) throw new Error(`Unknown preference ${id}`)
  if (!field.scopes.some((s) => s === scope)) throw new Error(`${id} cannot be set for ${scope}`)
  const layer = layers[scope]
  return { ...layers, [scope]: { ...layer, fields: { ...layer.fields, [id]: { value, at: now, by: editor } } } }
}

/** Removing an override is a tombstone-free delete; `mergeLayer` needs `removed` to avoid resurrecting it. */
export function clearOverride(layers: PreferenceLayers, scope: PreferenceScope, id: string): PreferenceLayers {
  const layer = layers[scope]
  return { ...layers, [scope]: { ...layer, fields: withoutKey(layer.fields, id) } }
}

const newer = (a: PreferenceEntry, b: PreferenceEntry) => a.at > b.at || (a.at === b.at && a.by >= b.by)

/**
 * Merge a remote layer into a local one field by field. A newer entry wins, an older (stale) remote entry is discarded,
 * fields only one side knows survive, and fields removed locally stay removed when `removed` lists them.
 */
export function mergeLayer(
  local: PreferenceLayer,
  remote: PreferenceLayer,
  removed: readonly string[] = [],
): PreferenceLayer {
  const fields: Record<string, PreferenceEntry> = { ...local.fields }
  for (const [id, entry] of Object.entries(remote.fields)) {
    if (removed.includes(id)) continue
    const mine = fields[id]
    if (!mine || !newer(mine, entry)) fields[id] = entry
  }
  return { v: Math.max(local.v, remote.v), fields }
}

/** Accept a layer from storage or the network. A newer contract version is kept as-is but only known fields are read. */
export function parseLayer(input: unknown): PreferenceLayer {
  if (!input || typeof input !== 'object') return emptyLayer()
  const raw = input as { v?: unknown; fields?: unknown }
  const fields: Record<string, PreferenceEntry> = {}
  if (raw.fields && typeof raw.fields === 'object')
    for (const [id, entry] of Object.entries(raw.fields as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue
      const { value, at, by } = entry as Partial<PreferenceEntry>
      if (typeof at !== 'number' || !Number.isFinite(at) || typeof by !== 'string') continue
      if (!isValue(value)) continue
      fields[id] = { value, at, by }
    }
  return { v: typeof raw.v === 'number' ? raw.v : PREFERENCE_VERSION, fields }
}

function isValue(value: unknown): value is PreferenceValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    (Array.isArray(value) && value.every((v) => typeof v === 'string'))
  )
}
