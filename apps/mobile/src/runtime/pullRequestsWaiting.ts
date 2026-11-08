import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { inPullRequestFilter, pullRequestRows } from '@ramu/shared/pullRequests'
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
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    const ids = online.split(',').filter(Boolean)
    let cancelled = false
    const read = () => {
      if (AppState.currentState !== 'active') return
      for (const id of ids)
        void store.invoke(id, 'forge.allPullRequests', false, false).then(
          (repositories) => {
            if (cancelled) return
            const waiting = pullRequestRows(repositories).filter((row) => inPullRequestFilter(row, 'needs-you')).length
            setCounts((all) => ({ ...all, [id]: waiting }))
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
  return online
    .split(',')
    .filter(Boolean)
    .reduce((sum, id) => sum + (counts[id] ?? 0), 0)
}
