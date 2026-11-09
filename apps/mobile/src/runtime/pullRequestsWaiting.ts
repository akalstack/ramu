import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import type { RepositoryPullRequests } from '@ramu/shared/types'
import { inPullRequestFilter, mergedPullRequestRows } from '@ramu/shared/pullRequests'
import { useStore } from './store'

/** The hosts keep their own short cache; this only decides how often the badge asks them. */
const EVERY = 120_000

/** Open pull requests waiting on the person across every online host, for the Pull requests tab's badge. */
export function usePullRequestsWaiting(): number {
  const store = useStore()
  const online = store.computers
    .filter((pc) => pc.status === 'online')
    .map((pc) => pc.id)
    .join(',')
  const [lists, setLists] = useState<Record<string, RepositoryPullRequests[]>>({})
  useEffect(() => {
    const ids = online.split(',').filter(Boolean)
    let cancelled = false
    const read = () => {
      if (AppState.currentState !== 'active') return
      for (const id of ids)
        void store.invoke(id, 'forge.allPullRequests', false, false).then(
          (repositories) => {
            if (cancelled) return
            setLists((all) => ({ ...all, [id]: repositories }))
          },
          () => {
            // An older or unreachable host shows no count rather than a wrong one.
          },
        )
    }
    read()
    const timer = setInterval(read, EVERY)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') read()
    })
    return () => {
      cancelled = true
      clearInterval(timer)
      sub.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the online hosts; the store's invoke is stable
  }, [online])
  // A pull request whose repository several hosts have counts once.
  const ids = online.split(',').filter(Boolean)
  return mergedPullRequestRows(ids.map((host) => ({ host, repositories: lists[host] ?? [] }))).filter((row) =>
    inPullRequestFilter(row, 'needs-you'),
  ).length
}
