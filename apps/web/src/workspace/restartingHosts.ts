import { useSyncExternalStore } from 'react'
import { ownHostId } from '../hosts'

/** Hosts whose service is restarting on purpose: they read as restarting rather than offline until they answer. */
let restarting: ReadonlySet<string> = new Set()
let watching = false
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Read from the bridge on first use rather than on import, so views that show the state stay importable on their own.
  if (!watching && globalThis.window?.ramu) {
    watching = true
    window.ramu.on('background:connection', (payload, from) => {
      const host = from ?? ownHostId()
      if (!!payload.restarting === restarting.has(host)) return
      const next = new Set(restarting)
      if (payload.restarting) next.add(host)
      else next.delete(host)
      restarting = next
      for (const changed of listeners) changed()
    })
  }
  return () => {
    listeners.delete(listener)
  }
}

export function useRestartingHosts(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => restarting)
}
