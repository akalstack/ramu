import { useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { RepositoryBinding } from '@ramu/shared/types'
import { ipcQueryKey } from '../../dataQueries'
import { ramu } from '../../ipc'
import { errorText } from '../../workspace/TaskPane'

/** Status, history, branches and stashes of one repository, refreshed on file changes and `ramu:git-updated`. */
export function useRepositoryData(taskId: string, binding: RepositoryBinding, reportError: (message: string) => void) {
  const statusQuery = useQuery({
    queryKey: ipcQueryKey('git.status', taskId, binding.repoId),
    queryFn: () => ramu.invoke('git.status', taskId, binding.repoId),
  })
  const historyQuery = useQuery({
    queryKey: ipcQueryKey('git.history', taskId, binding.repoId),
    queryFn: () => ramu.invoke('git.history', taskId, binding.repoId),
  })
  const branchesQuery = useQuery({
    queryKey: ipcQueryKey('git.branches', taskId, binding.repoId),
    queryFn: () => ramu.invoke('git.branches', taskId, binding.repoId),
  })
  const stashesQuery = useQuery({
    queryKey: ipcQueryKey('git.stashes', taskId, binding.repoId),
    queryFn: () => ramu.invoke('git.stashes', taskId, binding.repoId),
  })

  useEffect(() => {
    for (const error of [statusQuery.error, historyQuery.error, branchesQuery.error, stashesQuery.error])
      if (error) reportError(errorText(error))
  }, [statusQuery.error, historyQuery.error, branchesQuery.error, stashesQuery.error, reportError])

  const load = useCallback(async () => {
    await Promise.all([statusQuery.refetch(), historyQuery.refetch(), branchesQuery.refetch(), stashesQuery.refetch()])
  }, [statusQuery.refetch, historyQuery.refetch, branchesQuery.refetch, stashesQuery.refetch, reportError])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = ramu.on('fs:changed', ({ cwd }) => {
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
  }, [load, binding.cwd])

  return {
    status: statusQuery.data ?? null,
    loading: statusQuery.isLoading,
    commits: historyQuery.data ?? [],
    stashes: stashesQuery.data ?? [],
    branches: branchesQuery.data ?? [],
    load,
  }
}
