import { useEffect, useState } from 'react'
import { useHost } from '../workspace/HostProvider'
import { isViewOnly } from './viewerAccess'

/** Whether the host this window is using paired it as view-only. Advisory: the server enforces the allowlist regardless. */
export function useViewOnly(): boolean {
  const { isLocal, invoke } = useHost()
  const [viewOnly, setViewOnly] = useState(false)
  useEffect(() => {
    if (isLocal) return setViewOnly(false)
    let live = true
    Promise.resolve(invoke('background.status')).then(
      (status) => live && setViewOnly(isViewOnly(status)),
      () => {},
    )
    return () => {
      live = false
    }
  }, [isLocal, invoke])
  return viewOnly
}
