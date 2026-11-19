import { useEffect, useState } from 'react'
import { useHost } from '../workspace/HostProvider'
import { isViewOnly } from './viewerAccess'

/** One status read per host, shared by every component that asks, so a long thread list does not ask once per row. */
type Read = {
  at: number
  value: Promise<boolean>
  confirmed?: boolean
  invoke: ReturnType<typeof useHost>['invoke']
  status: ReturnType<typeof useHost>['status']
}
const reads = new Map<string, Read>()
const FRESH_MS = 60_000

/** Whether the host this window is using paired it as view-only. Advisory: the server enforces the allowlist regardless. */
export function useViewOnly(): boolean {
  const { id, isLocal, invoke, status } = useHost()
  const [snapshot, setSnapshot] = useState<{ id: string; viewOnly: boolean } | null>(null)
  useEffect(() => {
    if (isLocal) return
    let live = true
    let read = reads.get(id)
    if (!read || read.invoke !== invoke || read.status !== status || Date.now() - read.at > FRESH_MS) {
      const known = read?.confirmed
      const next: Read = {
        at: Date.now(),
        invoke,
        status,
        confirmed: known,
        value: Promise.resolve(invoke('background.status')).then(
          (status) => {
            const value = status?.access === undefined ? (known ?? false) : isViewOnly(status)
            next.confirmed = value
            return value
          },
          // Failure supplies no new role evidence; retain a previously confirmed viewer restriction.
          () => known ?? false,
        ),
      }
      reads.set(id, next)
      read = next
    }
    void read.value.then((value) => live && setSnapshot({ id, viewOnly: value }))
    return () => {
      live = false
    }
  }, [id, isLocal, invoke, status])
  return isLocal ? false : snapshot?.id === id ? snapshot.viewOnly : (reads.get(id)?.confirmed ?? false)
}
