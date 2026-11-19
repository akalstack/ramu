import { useCallback, useEffect, useState } from 'react'
import type { SummariesSnapshot } from '@ramu/shared/types'
import type { invoke } from '../ipc'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'

/** The summaries on the computer this app talks to, kept current as they are created, read and dismissed. */
export function useSummaries(explicitCall?: typeof invoke) {
  const host = useHost()
  const call = explicitCall ?? host.invoke
  const { on } = useHostRuntime()
  const [snapshot, setSnapshot] = useState<SummariesSnapshot | null>(null)
  const reload = useCallback(() => call('summaries.get').then(setSnapshot), [call])
  useEffect(() => {
    void reload().catch(() => {})
    return on('summaries:changed', () => {
      void reload().catch(() => {})
    })
  }, [reload, on])
  return { snapshot, reload }
}
