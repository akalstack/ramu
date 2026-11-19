import { useRef } from 'react'
import { useHost } from '../workspace/HostProvider'
import { useViewOnly } from './useViewOnly'

/** A retained action belongs to its original host and must still have write access when it runs. */
export function useHostWriteAccess() {
  const host = useHost()
  const viewOnly = useViewOnly()
  const id = host.id
  const latest = useRef({ id: host.id, viewOnly, connected: host.isLocal || host.status === 'connected' })
  latest.current = { id: host.id, viewOnly, connected: host.isLocal || host.status === 'connected' }
  const bound = useRef({
    id,
    check: () => latest.current.id === id && latest.current.connected && !latest.current.viewOnly,
  })
  if (bound.current.id !== id)
    bound.current = {
      id,
      check: () => latest.current.id === id && latest.current.connected && !latest.current.viewOnly,
    }
  return { viewOnly, canWrite: bound.current.check }
}
