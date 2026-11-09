import {
  MODEL_FLOW_FIELD,
  inheritedModelFlow,
  resolveModelFlow,
  type ModelFlow,
  type ResolvedModelFlow,
} from '@ramu/shared/modelFlow'
import { emptyLayer, parseLayer, type PreferenceLayer } from '@ramu/shared/preferenceScopes'
import { useStore } from './store'
import { useEditorId, useSharedMobileSave } from './useScopedChoice'

const DEVICE_KEY = 'pref-device:modelFlow'

/** This phone's own override, kept in device storage next to the other drafts; never sent to a host. */
function deviceLayer(raw: string | undefined): PreferenceLayer {
  if (!raw) return emptyLayer()
  try {
    return parseLayer({ v: 1, fields: { [MODEL_FLOW_FIELD]: JSON.parse(raw) } })
  } catch {
    return emptyLayer()
  }
}

const own = (layer: PreferenceLayer): ModelFlow | undefined => {
  const entry = layer.fields[MODEL_FLOW_FIELD]
  return entry && !entry.cleared && (entry.value === 'model' || entry.value === 'effort') ? entry.value : undefined
}

export interface ModelFlowControl {
  /** What the model selector uses right now. */
  effective: ResolvedModelFlow
  /** The computer's own setting, used when neither this phone nor the shared mobile layer overrides it. */
  host: ModelFlow
  /** False until the computer's shared mobile setting has loaded. */
  sharedAvailable: boolean
  /** The value each narrower scope holds of its own, even when a narrower one currently hides it. */
  held: { mobile?: ModelFlow; device?: ModelFlow }
  /** What clearing the override at a scope would leave in effect, shown before the person confirms. */
  inherited(scope: 'mobile' | 'device'): ResolvedModelFlow
  /** A shared save in flight or failed, so the row can show pending and error states with a retry. */
  pending: boolean
  error: string | null
  setDevice(value: ModelFlow | null): void
  setMobile(value: ModelFlow | null): Promise<void>
}

/**
 * The model selection flow this phone shows: its own override, then the shared mobile setting on the computer, then
 * the computer's setting. Only the selected computer's settings are read, and a shared save never touches the
 * model sets, selected model or any draft.
 */
export function useModelFlow(computerId: string): ModelFlowControl {
  const store = useStore()
  const host: ModelFlow = store.modelPrefs[computerId]?.defaultBarMode === 'effort' ? 'effort' : 'model'
  const shared = store.mobileLayers[computerId]
  const device = deviceLayer(store.drafts[DEVICE_KEY])
  const layers = { mobile: shared ?? emptyLayer(), device }
  const save = useSharedMobileSave(computerId, MODEL_FLOW_FIELD)
  const editor = useEditorId()
  return {
    effective: resolveModelFlow(host, layers),
    host,
    sharedAvailable: shared !== null && shared !== undefined,
    held: { mobile: own(layers.mobile), device: own(layers.device) },
    inherited: (scope) => inheritedModelFlow(host, layers, scope),
    pending: save.pending,
    error: save.error,
    setDevice: (value) =>
      store.setDraft(DEVICE_KEY, value ? JSON.stringify({ value, at: Date.now(), by: editor() }) : ''),
    setMobile: (value) => save.save(value),
  }
}
