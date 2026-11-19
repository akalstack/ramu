import { useSyncExternalStore } from 'react'
import { ownHostId } from '../hosts'
import { invoke } from '../ipc'

/** Calls the server the summary belongs to: the local one, or the computer chosen in Settings. */
export type SummaryCall = typeof invoke
export type OpenSummary = { id: string; call: SummaryCall; host: string }

let current: OpenSummary | null = null
const listeners = new Set<() => void>()
const emit = () => {
  for (const listener of listeners) listener()
}

/** Shows the summary view for this summary from anywhere: Home, the history list or a notification. */
export function openSummary(id: string, call: SummaryCall = invoke, host = ownHostId()): void {
  current = { id, call, host }
  emit()
}
export function closeSummary(): void {
  current = null
  emit()
}
export function useOpenSummary(): OpenSummary | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => current,
  )
}
