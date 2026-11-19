import { useRef, useState } from 'react'
import type { PreferenceScope } from '@ramu/shared/preferenceScopes'
import { sharedValue, type SharedMobileField } from '@ramu/shared/sharedFields'
import { resolveLayered, type LayeredValues, type PreferenceSourceLabel } from './busyMode'
import { useStore } from './store'

const DEVICE_ID_KEY = 'pref-device-id'

/** Why a scope can't be changed from this phone right now; the row says so instead of appearing to save. */
export type ScopeBlock = 'host-update' | 'viewer' | 'permission' | 'offline'

/** One preference that applies to all devices, all your phones or this phone, as Settings shows and edits it. */
export interface ScopedChoiceControl<V extends string> {
  /** What this phone uses right now, and which scope it comes from. */
  effective: { value: V; source: PreferenceSourceLabel }
  /** What each scope holds; `all` is the computer's own setting, and an absent narrower scope has no value of its own. */
  held: LayeredValues<V>
  /** What clearing the value at a narrower scope would leave in effect, shown on the "use inherited" action. */
  inherited(scope: 'mobile' | 'device'): { value: V; source: PreferenceSourceLabel }
  /** Scopes that can't be saved from here, each with the reason. */
  blocked: Partial<Record<PreferenceScope, ScopeBlock>>
  /** A save for all your phones in flight or failed. */
  pending: boolean
  error: string | null
  /** Sets the value at a scope; null clears a narrower scope's own value. */
  set(scope: PreferenceScope, value: V | null): void
}

/** A stable id for edits this phone makes to shared layers, so ties between devices break the same way everywhere. */
export function useEditorId(): () => string {
  const store = useStore()
  return () => {
    let id = store.drafts[DEVICE_ID_KEY]
    if (!id) {
      id = `phone-${Math.random().toString(36).slice(2, 10)}`
      store.setDraft(DEVICE_ID_KEY, id)
    }
    return id
  }
}

/** Saves or clears one field of the selected computer's all-mobile layer, reporting pending and errors to the row. */
export function useSharedMobileSave(computerId: string, field: SharedMobileField) {
  const store = useStore()
  const editor = useEditorId()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sequence = useRef(0)
  const save = async (value: string | boolean | null) => {
    const mine = ++sequence.current
    setPending(true)
    setError(null)
    try {
      const result = await store.invoke(computerId, 'preferences.layers.set', {
        id: field,
        ...(value !== null ? { value } : {}),
        at: Date.now(),
        by: editor(),
      })
      store.setMobileLayer(computerId, result.mobile)
    } catch (e) {
      if (mine === sequence.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (mine === sequence.current) setPending(false)
    }
  }
  return { pending, error, save }
}

/**
 * A preference kept in three places: this phone's device storage, the computer's all-mobile layer, and the computer's
 * own setting (all devices). `read` checks a value from any of them, so an unreadable one counts as not set.
 */
export function useScopedChoice<V extends string>({
  computerId,
  field,
  deviceKey,
  fallback,
  read,
  toShared,
  all,
}: {
  computerId: string
  field: SharedMobileField
  /** This phone's own value in device storage; never sent to a host. */
  deviceKey: string
  fallback: V
  read: (value: unknown) => V | undefined
  toShared: (value: V) => string | boolean
  /** The computer's own setting and how to save it; `blocked` when this phone can't change it. */
  all: { value: unknown; blocked?: ScopeBlock; save: (value: V) => void }
}): ScopedChoiceControl<V> {
  const store = useStore()
  const layer = store.mobileLayers[computerId]
  const shared = useSharedMobileSave(computerId, field)
  const viewer = store.computers.find((computer) => computer.id === computerId)?.access === 'viewer'
  const held: LayeredValues<V> = {
    device: read(store.drafts[deviceKey]),
    mobile: read(sharedValue(layer, field)),
    all: read(all.value),
  }
  const blocked: Partial<Record<PreferenceScope, ScopeBlock>> = {}
  if (all.blocked) blocked.all = all.blocked
  // A computer that never answered the layer read is too old to hold it; a viewer may read the layer but not write it.
  if (!layer) blocked.mobile = 'host-update'
  else if (viewer) blocked.mobile = 'viewer'
  return {
    effective: resolveLayered(held, fallback),
    held,
    inherited: (scope) =>
      resolveLayered({ ...held, [scope]: undefined, ...(scope === 'mobile' ? { device: undefined } : {}) }, fallback),
    blocked,
    pending: shared.pending,
    error: shared.error,
    set(scope, value) {
      if (blocked[scope]) return
      if (scope === 'device') store.setDraft(deviceKey, value ?? '')
      else if (scope === 'mobile') void shared.save(value === null ? null : toShared(value))
      else if (value !== null) all.save(value)
    },
  }
}
