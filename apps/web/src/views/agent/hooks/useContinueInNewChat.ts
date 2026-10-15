import { useState } from 'react'
import { clipText } from '@ramu/shared/text'
import type { AgentSessionInfo, AgentSettings } from '@ramu/shared/types'
import { invoke } from '../../../ipc'
import { errorText } from '../../../TaskPane'
import { useWorkspaceActions } from '../../../workspace'

/** "Continue in new chat": a fresh chat in the same checkout that opens with this one's transcript as hidden context. */
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
  const [continuing, setContinuing] = useState(false),
    [confirmContinue, setConfirmContinue] = useState(false)
  const continueInNewChat = async () => {
    const previous = session && ws.task(session.taskId)
    if (!session || !previous) return
    setContinuing(true)
    let created: string | null = null
    try {
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
  return { continuing, confirmContinue, setConfirmContinue, continueInNewChat }
}
