import { useCallback, type ReactNode } from 'react'
import type { HostDestination } from '@ramu/shared/hostOverview'
import { useHostSelection } from './HostSelection'
import { HostStore } from './workspace'

/**
 * One host's view on a page that lists every host's items (Pull requests, Artifacts): it reads and acts on `host`,
 * and a thread it opens or starts brings that host on screen, as opening a thread from the sidebar does.
 */
export function HostContent({ host, fallback, children }: { host: string; fallback?: ReactNode; children: ReactNode }) {
  const { activeHost, select } = useHostSelection()
  const navigate = useCallback((destination: HostDestination) => select(host, destination), [host, select])
  return (
    <HostStore host={host} navigate={host === activeHost ? undefined : navigate} fallback={fallback}>
      {children}
    </HostStore>
  )
}
