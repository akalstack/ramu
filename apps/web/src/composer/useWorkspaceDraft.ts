import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceChoice } from '@ramu/shared/workspaceDefaults'
import { draftStore } from './drafts'
import { loadWorkspaceDraft, saveWorkspaceDraft, type WorkspaceDraft } from './workspaceDraft'

interface State extends WorkspaceDraft {
  key: string
  confirmed: boolean
}

/** Restores intent within its original host/project, while explicit scoped entry points take precedence. */
export function useWorkspaceDraft(host: string, projectId: string, explicitWorkspace: string | null) {
  const key = JSON.stringify([host, projectId, explicitWorkspace])
  const active = useRef(key)
  active.current = key
  const restore = useCallback((): State => {
    if (explicitWorkspace) return { key, choice: { mode: 'worktree', workspaceId: explicitWorkspace }, confirmed: true }
    const saved = loadWorkspaceDraft(projectId, draftStore(host))
    return { ...saved, key, confirmed: !saved.problem }
  }, [key, host, projectId, explicitWorkspace])
  const [state, setState] = useState<State>(restore)
  const current = state.key === key ? state : restore()
  useEffect(() => {
    const next = restore()
    if (explicitWorkspace && !saveWorkspaceDraft(projectId, next.choice, draftStore(host))) next.problem = 'storage'
    setState(next)
  }, [restore, explicitWorkspace, projectId, host])

  const choose = (choice: WorkspaceChoice) => {
    if (active.current !== key) return
    const saved = saveWorkspaceDraft(projectId, choice, draftStore(host))
    setState({ key, choice, confirmed: true, ...(saved ? {} : { problem: 'storage' as const }) })
  }
  return { ...current, choose, retry: () => choose(current.choice) }
}
