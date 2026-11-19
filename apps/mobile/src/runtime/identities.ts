// A host's identities on the phone, for the chips on project sections and thread headers, the identity picker in a
// project's actions, and grouping the thread list. Read once per host and again when the host says they changed.
import { useEffect, useRef, useState } from 'react'
import type { IdentitySnapshot, ProjectIdentity } from '@ramu/shared/identities'
import { useStore } from './store'

export function useHostIdentities(hostId: string | undefined): IdentitySnapshot | null {
  const store = useStore()
  const runtime = useRef(store)
  runtime.current = store
  const online = hostId ? store.isOnline(hostId) : false
  const [snapshot, setSnapshot] = useState<IdentitySnapshot | null>(null)
  useEffect(() => {
    if (!hostId || !online) return
    let active = true
    const read = () =>
      void runtime.current.invoke(hostId, 'identities.get').then(
        (next) => active && setSnapshot(next),
        () => active && setSnapshot(null),
      )
    read()
    const unsubscribe = runtime.current.subscribe(hostId, (...[channel]) => {
      if (channel === 'identities:changed') read()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [hostId, online])
  return snapshot
}

/** A phone project's identity (`<host>:<project>`), shown only once its host has two or more identities. */
export function projectIdentity(
  snapshot: IdentitySnapshot | null,
  projectId: string | null | undefined,
): ProjectIdentity | null {
  if (!snapshot || snapshot.settings.identities.length < 2 || !projectId) return null
  const raw = projectId.slice(projectId.indexOf(':') + 1)
  return snapshot.projects.find((entry) => entry.projectId === raw) ?? null
}
