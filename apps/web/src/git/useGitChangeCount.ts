import { useEffect, useState } from 'react'
import type { RepositoryBinding } from '@ramu/shared/types'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'

export interface GitChanges {
  count: number
  /** Lines added and removed across the checkout; only loaded when asked for. */
  added: number
  removed: number
}
const NONE: GitChanges = { count: 0, added: 0, removed: 0 }

/** Watch the active checkout's changes even when Source Control is closed; `lines` also totals added and removed lines. */
export function useGitChanges(taskId: string | null, bindings: RepositoryBinding[], lines = false): GitChanges {
  const key = JSON.stringify(
    bindings.filter((b) => b.setupState === 'ready' && !b.folderOnly).map((b) => ({ repoId: b.repoId, cwd: b.cwd })),
  )
  const { invoke } = useHost()
  const { on } = useHostRuntime()
  const [result, setResult] = useState({ context: '', changes: NONE })
  const context = `${taskId}:${key}:${lines}`
  useEffect(() => {
    if (!taskId) return
    const repositories = JSON.parse(key) as { repoId: string; cwd: string }[]
    let disposed = false,
      sequence = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      const request = ++sequence
      const [statuses, stats] = await Promise.all([
        Promise.allSettled(repositories.map((repo) => invoke('git.status', taskId, repo.repoId))),
        lines
          ? Promise.allSettled(repositories.map((repo) => invoke('git.lineStats', taskId, repo.repoId)))
          : Promise.resolve([]),
      ])
      // A failed read says nothing about the changes; keep showing the last count.
      if (disposed || request !== sequence || !statuses.every((result) => result.status === 'fulfilled')) return
      const count = statuses.reduce(
        (count, result) =>
          count + (result.status === 'fulfilled' ? new Set(result.value.entries.map((entry) => entry.path)).size : 0),
        0,
      )
      const fulfilled = stats.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
      setResult({
        context,
        changes: {
          count,
          added: fulfilled.reduce((sum, value) => sum + value.added, 0),
          removed: fulfilled.reduce((sum, value) => sum + value.removed, 0),
        },
      })
    }
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void load(), 150)
    }
    void load()
    const off = on('fs:changed', ({ cwd }) => {
      if (repositories.some((repo) => repo.cwd === cwd)) refresh()
    })
    window.addEventListener('ramu:git-updated', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      disposed = true
      off()
      clearTimeout(timer)
      window.removeEventListener('ramu:git-updated', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [invoke, on, taskId, key, lines, context])
  return result.context === context ? result.changes : NONE
}

/** The number of changed files in the active checkout. */
export function useGitChangeCount(taskId: string | null, bindings: RepositoryBinding[]) {
  return useGitChanges(taskId, bindings).count
}
