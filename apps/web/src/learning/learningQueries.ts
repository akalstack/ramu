import { useEffect } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import type { InboxReview } from '@ramu/shared/hostInbox'
import { ipcQueryKeyOn, queryClient } from '../dataQueries'
import { invokeUncachedOn } from '../ipc'
import { onHostEvent } from '../workspace/workspace'

const learningKey = (host: string) => ipcQueryKeyOn(host, 'learning.get')

const learningQuery = (host: string, enabled: boolean) => ({
  queryKey: learningKey(host),
  // Straight to the transport: this query already owns the cache key a cached `invoke` would read through.
  queryFn: () => invokeUncachedOn(host, 'learning.get'),
  enabled,
})

/**
 * Every turn's line and every Inbox row reads one shared snapshot per host, so a change on the host refetches it once:
 * `cancelRefetch: false` joins a read already on its way instead of restarting it for each listener.
 */
function useRefetchOnMemoryChange(hosts: string[]) {
  const key = hosts.join('\n')
  useEffect(() => {
    const offs = key
      .split('\n')
      .filter(Boolean)
      .map((host) =>
        onHostEvent(host, 'memory:changed', () => {
          void queryClient.invalidateQueries({ queryKey: learningKey(host) }, { cancelRefetch: false })
        }),
      )
    return () => offs.forEach((off) => off())
  }, [key])
}

/** One host's learning reviews and skills, kept current while shown. */
export function useLearningSnapshot(host: string, enabled = true) {
  useRefetchOnMemoryChange(enabled ? [host] : [])
  return useQuery(learningQuery(host, enabled)).data
}

/** Reviews on each of these hosts, addressed by host; a host that cannot be read adds none. */
export function useLearningReviews(hosts: string[]): InboxReview[] {
  useRefetchOnMemoryChange(hosts)
  const results = useQueries({ queries: hosts.map((host) => learningQuery(host, true)) })
  return hosts.flatMap((host, index) => (results[index]?.data?.jobs ?? []).map((job) => ({ computerId: host, job })))
}

/** Reads the host's snapshot again after an action, rather than waiting for its change event. */
export const refreshLearning = (host: string) =>
  queryClient.invalidateQueries({ queryKey: learningKey(host) }, { cancelRefetch: false })
