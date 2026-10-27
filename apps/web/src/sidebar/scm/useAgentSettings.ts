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
  const activeViewId = ws.taskUi[taskId]?.activeAgentViewId
  useEffect(() => {
    let cancelled = false
    const view = ws.taskUi[taskId]?.views.find((v) => v.id === activeViewId)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [invoke, on, taskId, activeViewId] by design; the values it reads beyond these are current as of that run
  }, [invoke, on, taskId, activeViewId])
  return [settings, setSettings] as const
}
