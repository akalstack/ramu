import { useSyncExternalStore } from 'react'
import { readUsageReveal, saveUsageReveal } from '../storage'

// One value for every screen that names logins, so hiding them in Plan usage also hides them in Settings.
let shown: boolean | null = null
const listeners = new Set<() => void>()

const current = () => (shown ??= readUsageReveal())

export function setUsageReveal(next: boolean) {
  shown = next
  saveUsageReveal(next)
  for (const listener of listeners) listener()
}

/** Whether login labels and emails are shown in plan usage on this phone. */
export function useUsageReveal(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    current,
    current,
  )
}
