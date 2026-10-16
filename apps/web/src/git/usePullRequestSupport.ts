import { useQueries, useQuery } from '@tanstack/react-query'
import { ipcQueryKey } from '../dataQueries'
import { ramu } from '../ipc'

const options = (taskId: string, repoId: string, branch: string | null, enabled: boolean) => ({
  queryKey: ipcQueryKey('forge.pullRequest', taskId, repoId, branch),
  queryFn: () => ramu.invoke('forge.pullRequest', taskId, repoId),
  enabled,
})

/** Whether this repository can open pull requests here: a GitHub remote, with `gh` installed and signed in. */
export function usePullRequestSupport(taskId: string, repoId: string, branch: string | null, remote?: boolean) {
  return useQuery(options(taskId, repoId, branch, !!remote)).data?.availability === 'ready'
}

/** The same check for a chat's repositories: true when any of them supports pull requests. */
export function useAnyPullRequestSupport(taskId: string, repoIds: string[]) {
  return useQueries({
    queries: repoIds.map((repoId) => options(taskId, repoId, null, true)),
    combine: (results) => results.some((result) => result.data?.availability === 'ready'),
  })
}
