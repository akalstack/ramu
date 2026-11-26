import { useSyncExternalStore } from 'react'

// Hosts this window is reading again after a gap. Connected is not yet up to date: until the read ends, a host's rows
// may be from before the gap, and its status says so.
const reading = new Map<string, number>()
const listeners = new Set<() => void>()
let snapshot: ReadonlySet<string> = new Set()

const publish = () => {
  snapshot = new Set(reading.keys())
  for (const listener of listeners) listener()
}

/** Marks `host` as synchronizing until `read` settles; overlapping reads keep it marked until the last one ends. */
export function hostSyncing(host: string, read: Promise<unknown>): void {
  reading.set(host, (reading.get(host) ?? 0) + 1)
  publish()
  const done = () => {
    const left = (reading.get(host) ?? 1) - 1
    if (left > 0) reading.set(host, left)
    else reading.delete(host)
    publish()
  }
  read.then(done, done)
}

/** The hosts being read again right now. */
export function useSyncingHosts(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => snapshot,
  )
}
