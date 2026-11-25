import { useQueries, useQuery } from '@tanstack/react-query'
import { ipcQueryKeyOn } from '../dataQueries'
import { useHost } from '../workspace/HostProvider'
import { queryInvokerFor } from './hostQuery'
import { keptPullRequestRead } from './keptPullRequests'

const options = (host: string, taskId: string, repoId: string, branch: string | null, enabled: boolean) => ({
  queryKey: ipcQueryKeyOn(host, 'forge.pullRequest', taskId, repoId, branch),
  queryFn: () => queryInvokerFor(host)('forge.pullRequest', taskId, repoId),
  ...keptPullRequestRead(host, 'forge.pullRequest', taskId, repoId, branch),
  enabled,
})

/** Whether this repository can open pull requests here: a GitHub remote, with `gh` installed and signed in. */
export function usePullRequestSupport(taskId: string, repoId: string, branch: string | null, remote?: boolean) {
  const host = useHost().id
  return useQuery(options(host, taskId, repoId, branch, !!remote)).data?.availability === 'ready'
}

/** The same check for a chat's repositories: true when any of them supports pull requests. */
export function useAnyPullRequestSupport(taskId: string, repoIds: string[]) {
  const host = useHost().id
  return useQueries({
    queries: repoIds.map((repoId) => options(host, taskId, repoId, null, true)),
    combine: (results) => results.some((result) => result.data?.availability === 'ready'),
  })
}
