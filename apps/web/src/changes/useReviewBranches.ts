import { useEffect, useState } from 'react'
import type { ReviewBranchState } from '@ramu/shared/types'
import { errorText } from '../lib/errors'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'

/** Current/target branches of the review's repos, refreshed on focus, git HEAD changes and a slow timer. */
export function useReviewBranches(id: string, loadedId: string | undefined, visible: boolean) {
  const { invoke } = useHost()
  const { on } = useHostRuntime()
  const [branches, setBranches] = useState<ReviewBranchState[]>([]),
    [branchError, setBranchError] = useState<string | null>(null)
  useEffect(() => {
    setBranches([])
    setBranchError(null)
  }, [id])
  useEffect(() => {
    if (!loadedId || !visible) return
    let disposed = false,
      request = 0
    const refresh = async () => {
      const seq = ++request
      try {
        const next = await invoke('reviews.branches', id)
        if (!disposed && seq === request) {
          setBranches(next)
          setBranchError(null)
        }
      } catch (reason) {
        if (!disposed && seq === request) setBranchError(errorText(reason))
      }
    }
    void refresh()
    const timer = window.setInterval(() => {
      if (!document.documentElement.hasAttribute('data-workspace-hidden') && document.visibilityState === 'visible')
        void refresh()
    }, 15000)
    window.addEventListener('focus', refresh)
    const off = on('fs:changed', ({ path }) => {
      if (path === '.git/HEAD') void refresh()
    })
    return () => {
      disposed = true
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      off()
    }
  }, [invoke, on, loadedId, id, visible])
  return { branches, branchError }
}
