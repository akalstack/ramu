import { useCallback, useEffect, useState } from 'react'
import type { SummariesSnapshot } from '@ramu/shared/types'
import { invoke, ramu } from '../ipc'

/** The summaries on the computer this app talks to, kept current as they are created, read and dismissed. */
export function useSummaries(call: typeof invoke = invoke) {
  const [snapshot, setSnapshot] = useState<SummariesSnapshot | null>(null)
  const reload = useCallback(() => call('summaries.get').then(setSnapshot), [call])
  useEffect(() => {
    void reload().catch(() => {})
    return ramu.on('summaries:changed', () => {
      void reload().catch(() => {})
    })
  }, [reload])
  return { snapshot, reload }
}
