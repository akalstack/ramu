import { useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { RepositoryBinding } from '@ramu/shared/types'
import { ipcQueryKeyOn } from '../../dataQueries'
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
    queryKey: ipcQueryKeyOn(host, 'git.status', taskId, binding.repoId),
    queryFn: () => call('git.status', taskId, binding.repoId),
  })
  const historyQuery = useQuery({
    queryKey: ipcQueryKeyOn(host, 'git.history', taskId, binding.repoId),
    queryFn: () => call('git.history', taskId, binding.repoId),
  })
  const branchesQuery = useQuery({
    queryKey: ipcQueryKeyOn(host, 'git.branches', taskId, binding.repoId),
    queryFn: () => call('git.branches', taskId, binding.repoId),
  })
  const stashesQuery = useQuery({
    queryKey: ipcQueryKeyOn(host, 'git.stashes', taskId, binding.repoId),
    queryFn: () => call('git.stashes', taskId, binding.repoId),
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
