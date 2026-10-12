import { useEffect, useState } from 'react'
import type { RepositoryBinding } from '../../shared/types'
import { invoke, ramu } from './ipc'

/** Watch the active checkout even when Source Control is closed. */
export function useGitChangeCount(taskId: string | null, bindings: RepositoryBinding[]) {
  const key = JSON.stringify(bindings.filter(b => b.setupState === 'ready' && !b.folderOnly).map(b => ({ repoId: b.repoId, cwd: b.cwd })))
  const [result, setResult] = useState({ context: '', count: 0 })
  const context = `${taskId}:${key}`
  useEffect(() => {
    if (!taskId) return
    const repositories = JSON.parse(key) as { repoId: string; cwd: string }[]
    let disposed = false, sequence = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      const request = ++sequence
      const results = await Promise.allSettled(repositories.map(repo => invoke('git.status', taskId, repo.repoId)))
      if (!disposed && request === sequence) setResult({ context, count: results.reduce((count, result) => count + (result.status === 'fulfilled' ? new Set(result.value.entries.map(entry => entry.path)).size : 0), 0) })
    }
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => void load(), 150) }
    void load()
    const off = ramu.on('fs:changed', ({ cwd }) => { if (repositories.some(repo => repo.cwd === cwd)) refresh() })
    window.addEventListener('ramu:git-updated', refresh)
    window.addEventListener('focus', refresh)
    return () => { disposed = true; off(); clearTimeout(timer); window.removeEventListener('ramu:git-updated', refresh); window.removeEventListener('focus', refresh) }
  }, [taskId, key, context])
  return result.context === context ? result.count : 0
}
