import { useState } from 'react'
import { clipText } from '@ramu/shared/text'
import { NO_PROJECT, type AgentSessionInfo, type AgentSettings } from '@ramu/shared/types'
import { useHost } from '../../../workspace/HostProvider'
import { errorText } from '../../../workspace/TaskPane'
import { useWorkspaceActions } from '../../../workspace/workspace'

/** "Continue in new chat": a fresh chat that opens with this one's transcript as hidden context, in the same checkout
 * or, for a thread on the project's checkout, a new worktree that brings its uncommitted changes. */
export function useContinueInNewChat({
  session,
  pendingSettings,
  setError,
}: {
  session: AgentSessionInfo | null
  pendingSettings: AgentSettings | null
  setError: (message: string | null) => void
}) {
  const ws = useWorkspaceActions()
  const { invoke } = useHost()
  const [continuing, setContinuing] = useState(false),
    [confirmContinue, setConfirmContinue] = useState(false)
  const previous = session ? ws.task(session.taskId) : undefined
  /** Only a thread on the project's own checkout can move to a worktree; one already in a worktree has its own. */
  const canUseWorktree = !!previous && previous.projectId !== NO_PROJECT && previous.mode === 'current'
  const continueInNewChat = async (worktree = false) => {
    if (!session || !previous) return
    setContinuing(true)
    let created: string | null = null
    try {
      if (worktree && canUseWorktree) {
        // The host creates the worktree, copies the uncommitted changes and links both threads in one call.
        const started = await invoke('threads.continueInWorktree', session.id, pendingSettings ?? undefined)
        await ws.refresh()
        ws.openTask(started.taskId)
        return
      }
      const prompt = await invoke('agent.continuationPrompt', session.id)
      const task = await invoke('tasks.create', {
        projectId: previous.projectId,
        title: clipText(`Continue: ${previous.title}`, 60),
        mode: previous.mode,
        workspaceId: previous.workspaceId ?? undefined,
      })
      created = task.id
      const next = await invoke('agent.start', task.id, prompt, pendingSettings ?? session.settings, [], [])
      created = null
      await ws.refresh()
      ws.openTask(task.id)
      ws.openView(task.id, { kind: 'agent', sessionId: next.id })
    } catch (e) {
      if (created) {
        await invoke('tasks.delete', created, false).catch(() => {})
        await ws.refresh().catch(() => {})
      }
      setError(errorText(e))
    } finally {
      setContinuing(false)
      setConfirmContinue(false)
    }
  }
  return { continuing, confirmContinue, setConfirmContinue, continueInNewChat, canUseWorktree }
}
