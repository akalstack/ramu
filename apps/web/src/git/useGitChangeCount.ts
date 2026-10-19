import { useEffect } from 'react'
import { useQueries } from '@tanstack/react-query'
import { queryClient } from '../dataQueries'
import { queryInvokerFor } from './hostQuery'
import { repositoryQueryKey } from './repositoryQueryKey'
import type { RepositoryBinding } from '@ramu/shared/types'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'

export interface GitChanges {
  count: number
  /** Lines added and removed across the checkout; only loaded when asked for. */
  added: number
  removed: number
}

/** Watch the active checkout's changes even when Source Control is closed; `lines` also totals added and removed lines. */
export function useGitChanges(taskId: string | null, bindings: RepositoryBinding[], lines = false): GitChanges {
  const key = JSON.stringify(
    bindings.filter((b) => b.setupState === 'ready' && !b.folderOnly).map((b) => ({ repoId: b.repoId, cwd: b.cwd })),
  )
  const { id: host } = useHost()
  const { on } = useHostRuntime()
  const call = queryInvokerFor(host)
  const repositories = taskId ? (JSON.parse(key) as { repoId: string; cwd: string }[]) : []
  const statuses = useQueries({
    queries: repositories.map((repo) => ({
      queryKey: repositoryQueryKey(host, 'git.status', repo),
      queryFn: () => call('git.status', taskId!, repo.repoId),
    })),
  })
  const stats = useQueries({
    queries: (lines ? repositories : []).map((repo) => ({
      queryKey: repositoryQueryKey(host, 'git.lineStats', repo),
      queryFn: () => call('git.lineStats', taskId!, repo.repoId),
    })),
  })
  useEffect(() => {
    if (!taskId) return
    const repositories = JSON.parse(key) as { repoId: string; cwd: string }[]
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        for (const repo of repositories) {
          void queryClient.refetchQueries(
            { queryKey: repositoryQueryKey(host, 'git.status', repo), type: 'active' },
            { cancelRefetch: false },
          )
          if (lines)
            void queryClient.refetchQueries(
              { queryKey: repositoryQueryKey(host, 'git.lineStats', repo), type: 'active' },
              { cancelRefetch: false },
            )
        }
      }, 150)
    }
    const off = on('fs:changed', ({ cwd }) => {
      if (repositories.some((repo) => repo.cwd === cwd)) refresh()
    })
    window.addEventListener('ramu:git-updated', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      off()
      clearTimeout(timer)
      window.removeEventListener('ramu:git-updated', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [host, on, taskId, key, lines])
  return {
    count: statuses.reduce((sum, result) => sum + new Set(result.data?.entries.map((entry) => entry.path)).size, 0),
    added: stats.reduce((sum, result) => sum + (result.data?.added ?? 0), 0),
    removed: stats.reduce((sum, result) => sum + (result.data?.removed ?? 0), 0),
  }
}

/** The number of changed files in the active checkout. */
export function useGitChangeCount(taskId: string | null, bindings: RepositoryBinding[]) {
  return useGitChanges(taskId, bindings).count
}
