import { useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { RepositoryBinding } from '@ramu/shared/types'
import { repositoryQueryKey } from '../../git/repositoryQueryKey'
import { useHost } from '../../workspace/HostProvider'
import { useHostRuntime } from '../../workspace/workspace'
import { queryInvokerFor } from '../../git/hostQuery'
import { errorText } from '../../workspace/TaskPane'

/** Status, history, branches and stashes of one repository, refreshed on file changes and `ramu:git-updated`. */
export function useRepositoryData(taskId: string, binding: RepositoryBinding, reportError: (message: string) => void) {
  const host = useHost().id
  const { on } = useHostRuntime()
  const call = queryInvokerFor(host)
  const statusQuery = useQuery({
    queryKey: repositoryQueryKey(host, 'git.status', binding),
    queryFn: () => call('git.status', taskId, binding.repoId),
  })
  const historyQuery = useQuery({
    queryKey: repositoryQueryKey(host, 'git.history', binding),
    queryFn: () => call('git.history', taskId, binding.repoId),
  })
  const branchesQuery = useQuery({
    queryKey: repositoryQueryKey(host, 'git.branches', binding),
    queryFn: () => call('git.branches', taskId, binding.repoId),
  })
  const stashesQuery = useQuery({
    queryKey: repositoryQueryKey(host, 'git.stashes', binding),
    queryFn: () => call('git.stashes', taskId, binding.repoId),
  })

  useEffect(() => {
    for (const error of [statusQuery.error, historyQuery.error, branchesQuery.error, stashesQuery.error])
      if (error) reportError(errorText(error))
  }, [statusQuery.error, historyQuery.error, branchesQuery.error, stashesQuery.error, reportError])

  const { refetch: refreshStatus } = statusQuery
  const { refetch: refreshHistory } = historyQuery
  const { refetch: refreshBranches } = branchesQuery
  const { refetch: refreshStashes } = stashesQuery
  const load = useCallback(async () => {
    await Promise.all([
      refreshStatus({ cancelRefetch: false }),
      refreshHistory({ cancelRefetch: false }),
      refreshBranches({ cancelRefetch: false }),
      refreshStashes({ cancelRefetch: false }),
    ])
  }, [refreshStatus, refreshHistory, refreshBranches, refreshStashes])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = on('fs:changed', ({ cwd }) => {
      if (cwd === binding.cwd) {
        clearTimeout(timer)
        timer = setTimeout(() => void load(), 150)
      }
    })
    const refresh = () => void load()
    window.addEventListener('ramu:git-updated', refresh)
    return () => {
      off()
      clearTimeout(timer)
      window.removeEventListener('ramu:git-updated', refresh)
    }
  }, [on, load, binding.cwd])

  return {
    status: statusQuery.data ?? null,
    loading: statusQuery.isLoading,
    commits: historyQuery.data ?? [],
    stashes: stashesQuery.data ?? [],
    branches: branchesQuery.data ?? [],
    load,
  }
}
