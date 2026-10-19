import { useEffect, useState } from 'react'
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '@ramu/shared/types'
import { useHostRuntime, useWorkspace } from '../../workspace/workspace'
import { useHost } from '../../workspace/HostProvider'

/** Model settings for drafting commit messages, mirroring the task's active agent chat. */
export function useAgentSettings(taskId: string) {
  const ws = useWorkspace()
  const { invoke } = useHost()
  const { on } = useHostRuntime()
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_AGENT_SETTINGS)
  useEffect(() => {
    let cancelled = false
    const view = ws.taskUi[taskId]?.views.find((v) => v.id === ws.taskUi[taskId]?.activeAgentViewId)
    if (view?.kind === 'agent')
      void invoke('agent.get', view.sessionId).then((s) => {
        if (!cancelled) setSettings(s.settings)
      })
    const off = on('agent:event', ({ sessionId, event }) => {
      if (view?.kind === 'agent' && sessionId === view.sessionId && event.kind === 'settings')
        setSettings(event.settings)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [invoke, on, taskId, ws.taskUi[taskId]?.activeAgentViewId])
  return [settings, setSettings] as const
}
