import { useHostWriteAccess } from '../../composer/useHostWriteAccess'
import { useEffect, useRef } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../workspace/TaskPane'
import { registerCommitTarget } from '../../git/commitShortcut'
import type { CommitFn } from './useCommitFlow'

/** Registers this section as the target of the Commit & Push shortcut; returns the ref for the section root. */
export function useCommitShortcut({
  taskId,
  repoId,
  staged,
  unstaged,
  publishable,
  commit,
  reportError,
}: {
  taskId: string
  repoId: string
  staged: number
  unstaged: string[]
  publishable: boolean
  commit: CommitFn
  reportError: (message: string) => void
}) {
  const { viewOnly, canWrite } = useHostWriteAccess()
  // The Commit & Push shortcut (commitShortcut.ts) runs this section's own commit, typed message included.
  const shortcut = useRef({ staged: 0, unstaged: [] as string[], publishable: false, commit })
  shortcut.current = { staged, unstaged, publishable, commit }
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (viewOnly) return
    return registerCommitTarget({
      taskId,
      repoId,
      staged: () => shortcut.current.staged,
      changes: () => shortcut.current.staged + shortcut.current.unstaged.length,
      focused: () => !!root.current?.contains(document.activeElement),
      // Smart commit: with nothing staged, every change is staged first.
      commitAndPush: async (pullRequest = false) => {
        if (!canWrite()) return
        const { publishable } = shortcut.current
        if (!publishable)
          return reportError(
            t('This repository has no branch with a remote to push to, or has an unresolved conflict.'),
          )
        try {
          await shortcut.current.commit('push', undefined, true, pullRequest)
        } catch (reason) {
          reportError(errorText(reason))
        }
      },
    })
  }, [taskId, repoId, reportError, viewOnly, canWrite])
  return root
}
