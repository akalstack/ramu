import {
  emptyLayer,
  emptyLayers,
  resolvePreference,
  setOverride,
  type PreferenceEntry,
  type PreferenceLayer,
  type PreferenceScope,
  type PreferenceSource,
  type PreferenceValue,
} from './preferenceScopes'

// Model selection flow across scopes. The execution host's own setting (`$models.defaultBarMode`) is the all-device
// baseline, so desktop and older hosts keep working unchanged. A host-stored mobile layer and a phone-local device layer
// override it, resolved by the shared preference resolver.

export type ModelFlow = 'model' | 'effort'
export const MODEL_FLOW_FIELD = 'modelFlow'
export const isModelFlow = (value: unknown): value is ModelFlow => value === 'model' || value === 'effort'

const newer = (a: PreferenceEntry, b: PreferenceEntry) => a.at > b.at || (a.at === b.at && a.by >= b.by)

/**
 * Apply one edit to a layer. An edit older than what the layer already holds is discarded, so a stale write from a
 * device that was offline cannot undo a newer choice. `value: undefined` clears the override (use the inherited one) and leaves a marker so it stays cleared.
 */
export function applyLayerEdit(
  layer: PreferenceLayer,
  id: string,
  edit: { value?: PreferenceValue; at: number; by: string },
): { layer: PreferenceLayer; applied: boolean } {
  const mine = layer.fields[id]
  const incoming: PreferenceEntry =
    edit.value === undefined
      ? { value: null, at: edit.at, by: edit.by, cleared: true }
      : { value: edit.value, at: edit.at, by: edit.by }
  if (mine && !newer(incoming, mine)) return { layer, applied: false }
  return { layer: { ...layer, fields: { ...layer.fields, [id]: incoming } }, applied: true }
}

/** What a host answers for the shared mobile layer; absent on older hosts. */
export interface PreferenceLayersSnapshot {
  protocol: 1
  mobile: PreferenceLayer
}

export interface ResolvedModelFlow {
  value: ModelFlow
  source: PreferenceSource
}

/** Device override, then mobile override, then the host's setting. An unreadable stored value is ignored. */
export function resolveModelFlow(
  host: ModelFlow,
  layers: { mobile: PreferenceLayer; device: PreferenceLayer },
): ResolvedModelFlow {
  const readable = (layer: PreferenceLayer) =>
    isModelFlow(layer.fields[MODEL_FLOW_FIELD]?.value) ? layer : emptyLayer()
  const base = setOverride(emptyLayers(), 'all', MODEL_FLOW_FIELD, host, 'host', 0)
  const { value, source } = resolvePreference(
    { all: base.all, mobile: readable(layers.mobile), device: readable(layers.device) },
    MODEL_FLOW_FIELD,
  )
  return { value: isModelFlow(value) ? value : host, source }
}

/** What the person gets after removing the override at `scope`, for the preview shown before they confirm. */
export function inheritedModelFlow(
  host: ModelFlow,
  layers: { mobile: PreferenceLayer; device: PreferenceLayer },
  scope: Exclude<PreferenceScope, 'all'>,
): ResolvedModelFlow {
  return resolveModelFlow(host, { ...layers, [scope]: emptyLayer() })
}
