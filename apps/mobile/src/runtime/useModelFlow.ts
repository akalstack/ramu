import { useRef, useState } from 'react'
import {
  MODEL_FLOW_FIELD,
  inheritedModelFlow,
  resolveModelFlow,
  type ModelFlow,
  type ResolvedModelFlow,
} from '@ramu/shared/modelFlow'
import { emptyLayer, parseLayer, type PreferenceLayer } from '@ramu/shared/preferenceScopes'
import { useStore } from './store'

const DEVICE_KEY = 'pref-device:modelFlow'
const DEVICE_ID_KEY = 'pref-device-id'

/** This phone's own override, kept in device storage next to the other drafts; never sent to a host. */
function deviceLayer(raw: string | undefined): PreferenceLayer {
  if (!raw) return emptyLayer()
  try {
    return parseLayer({ v: 1, fields: { [MODEL_FLOW_FIELD]: JSON.parse(raw) } })
  } catch {
    return emptyLayer()
  }
}

export interface ModelFlowControl {
  /** What the model selector uses right now. */
  effective: ResolvedModelFlow
  /** The computer's own setting, used when neither this phone nor the shared mobile layer overrides it. */
  host: ModelFlow
  /** False when the computer cannot hold a shared mobile setting (older version). */
  sharedAvailable: boolean
  /** Which narrower scopes hold their own value, even when a narrower one currently hides it. */
  overridden: { mobile: boolean; device: boolean }
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
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sequence = useRef(0)
  const editor = () => {
    let id = store.drafts[DEVICE_ID_KEY]
    if (!id) {
      id = `phone-${Math.random().toString(36).slice(2, 10)}`
      store.setDraft(DEVICE_ID_KEY, id)
    }
    return id
  }
  return {
    effective: resolveModelFlow(host, layers),
    host,
    sharedAvailable: shared !== null && shared !== undefined,
    overridden: {
      mobile: !!layers.mobile.fields[MODEL_FLOW_FIELD] && !layers.mobile.fields[MODEL_FLOW_FIELD]?.cleared,
      device: !!layers.device.fields[MODEL_FLOW_FIELD] && !layers.device.fields[MODEL_FLOW_FIELD]?.cleared,
    },
    inherited: (scope) => inheritedModelFlow(host, layers, scope),
    pending,
    error,
    setDevice: (value) =>
      store.setDraft(DEVICE_KEY, value ? JSON.stringify({ value, at: Date.now(), by: editor() }) : ''),
    async setMobile(value) {
      const mine = ++sequence.current
      setPending(true)
      setError(null)
      try {
        const result = await store.invoke(computerId, 'preferences.layers.set', {
          id: MODEL_FLOW_FIELD,
          ...(value ? { value } : {}),
          at: Date.now(),
          by: editor(),
        })
        store.setMobileLayer(computerId, result.mobile)
      } catch (e) {
        if (mine === sequence.current) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (mine === sequence.current) setPending(false)
      }
    },
  }
}
