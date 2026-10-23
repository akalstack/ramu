import { useEffect, useState } from 'react'
import { useHost } from '../workspace/HostProvider'
import { isViewOnly } from './viewerAccess'

/** One status read per host, shared by every component that asks, so a long thread list does not ask once per row. */
const reads = new Map<string, { at: number; value: Promise<boolean> }>()
const FRESH_MS = 60_000

/** Whether the host this window is using paired it as view-only. Advisory: the server enforces the allowlist regardless. */
export function useViewOnly(): boolean {
  const { id, isLocal, invoke } = useHost()
  const [viewOnly, setViewOnly] = useState(false)
  useEffect(() => {
    if (isLocal) return setViewOnly(false)
    let live = true
    let read = reads.get(id)
    if (!read || Date.now() - read.at > FRESH_MS) {
      read = {
        at: Date.now(),
        value: Promise.resolve(invoke('background.status')).then(
          (status) => isViewOnly(status),
          // An unreachable host is not proof of a role; keep offering actions and let the host refuse them.
          () => false,
        ),
      }
      reads.set(id, read)
    }
    void read.value.then((value) => live && setViewOnly(value))
    return () => {
      live = false
    }
  }, [id, isLocal, invoke])
  return viewOnly
}
