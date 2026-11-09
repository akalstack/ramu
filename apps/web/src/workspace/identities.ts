// Each host's identities and which one each of its projects acts as, for the chips on project rows and thread headers
// and for grouping the sidebar. One read per host, shared by every row, refreshed when that host says they changed.
import { useEffect, useSyncExternalStore } from 'react'
import type { IdentitySnapshot, ProjectIdentity } from '@ramu/shared/identities'
import { invokerFor, ramu } from '../ipc'

const snapshots = new Map<string, IdentitySnapshot | null>()
const listeners = new Set<() => void>()
const loading = new Map<string, Promise<void>>()
const emit = () => listeners.forEach((listener) => listener())

function load(hostId: string) {
  const pending = loading.get(hostId)
  if (pending) return pending
  const next = invokerFor(hostId)('identities.get')
    .then(
      (snapshot) => void snapshots.set(hostId, snapshot),
      () => void snapshots.set(hostId, null),
    )
    .finally(() => {
      loading.delete(hostId)
      emit()
    })
  loading.set(hostId, next)
  return next
}

let subscribed = false
function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!subscribed) {
    subscribed = true
    ramu.on('identities:changed', () => {
      for (const hostId of snapshots.keys()) void load(hostId)
    })
  }
  return () => void listeners.delete(listener)
}

/** The host's identities, or null before they are read or on a host without them. */
export function useIdentities(hostId: string): IdentitySnapshot | null {
  const snapshot = useSyncExternalStore(subscribe, () => snapshots.get(hostId) ?? null)
  useEffect(() => {
    if (!snapshots.has(hostId)) void load(hostId)
    // Another host's changes arrive with no event here; read again now and then.
    const timer = setInterval(() => void load(hostId), 60_000)
    return () => clearInterval(timer)
  }, [hostId])
  return snapshot
}

/** A project's identity, shown only once the host has two or more: with one, nothing new appears. */
export function useProjectIdentity(hostId: string, projectId: string | null | undefined): ProjectIdentity | null {
  const snapshot = useIdentities(hostId)
  if (!snapshot || snapshot.settings.identities.length < 2 || !projectId) return null
  return snapshot.projects.find((entry) => entry.projectId === projectId) ?? null
}

/** Reads a host's identities again after this window changed them. */
export const refreshIdentities = (hostId: string) => load(hostId)
