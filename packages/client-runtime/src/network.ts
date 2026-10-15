import { networkInterfaces } from 'node:os'

export interface NetworkState {
  available: boolean
  fingerprint: string
}
export interface NetworkMonitor {
  current(): NetworkState
  subscribe(changed: (force?: boolean) => void): () => void
}

/** Observe interfaces rather than guessing which VPN a user runs. Shared by all remote connections. */
export function networkState(): NetworkState {
  const addresses = Object.entries(networkInterfaces())
    .flatMap(([name, entries]) =>
      (entries ?? [])
        .filter((entry) => !entry.internal && !/^fe80:|^169\.254\./i.test(entry.address))
        .map((entry) => `${name}:${entry.address}:${entry.netmask}`),
    )
    .sort()
  return { available: addresses.length > 0, fingerprint: addresses.join('|') }
}

const listeners = new Set<(force?: boolean) => void>()
let state = networkState(),
  timer: NodeJS.Timeout | undefined
/** Also called when the desktop wakes, since interface addresses may stay unchanged across sleep. */
export function refreshRuntimeNetwork(force = false) {
  const next = networkState(),
    changed = next.fingerprint !== state.fingerprint
  state = next
  if (changed || force) for (const notify of listeners) notify(force)
}
export const runtimeNetwork: NetworkMonitor = {
  current: () => state,
  subscribe: (changed) => {
    if (!listeners.size) {
      state = networkState()
      timer = setInterval(() => refreshRuntimeNetwork(), 5000)
      timer.unref()
    }
    listeners.add(changed)
    return () => {
      listeners.delete(changed)
      if (!listeners.size) {
        clearInterval(timer)
        timer = undefined
      }
    }
  },
}
