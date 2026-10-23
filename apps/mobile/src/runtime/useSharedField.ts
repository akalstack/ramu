import { useRef, useState } from 'react'
import { sharedValue, type SharedMobileField } from '@ramu/shared/sharedFields'
import { useStore } from './store'

const DEVICE_ID_KEY = 'pref-device-id'

export interface SharedFieldControl {
  /** The shared mobile value on the selected computer, when it holds one this client can read. */
  value: string | boolean | undefined
  /** False when the computer cannot hold a shared mobile setting (an older version, or not reached yet). */
  available: boolean
  /** A save in flight or failed, so the row can show pending and error states. */
  pending: boolean
  error: string | null
  /** Sets the shared value for every phone paired with this computer; null clears it. Touches no draft or thread. */
  setMobile(value: string | boolean | null): Promise<void>
}

/** One shared mobile field on the selected computer, written with the same per-field revision as every other field. */
export function useSharedField(computerId: string, id: SharedMobileField): SharedFieldControl {
  const store = useStore()
  const layer = store.mobileLayers[computerId]
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sequence = useRef(0)
  const editor = () => {
    let by = store.drafts[DEVICE_ID_KEY]
    if (!by) {
      by = `phone-${Math.random().toString(36).slice(2, 10)}`
      store.setDraft(DEVICE_ID_KEY, by)
    }
    return by
  }
  return {
    value: sharedValue(layer, id) as string | boolean | undefined,
    available: layer !== null && layer !== undefined,
    pending,
    error,
    async setMobile(value) {
      const mine = ++sequence.current
      setPending(true)
      setError(null)
      try {
        const result = await store.invoke(computerId, 'preferences.layers.set', {
          id,
          ...(value === null ? {} : { value }),
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
