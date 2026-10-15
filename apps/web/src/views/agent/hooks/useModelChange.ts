import { useState } from 'react'
import type { AgentEvent, AgentSessionInfo, AgentSettings } from '@ramu/shared/types'
import { invoke } from '../../../ipc'
import { notifyError } from '../../../Notifications'
import { errorText } from '../../../TaskPane'

/**
 * Settings changes made in the controls under the message box. They stay pending until the next message, except
 * while the agent is working, when they take effect right away; switching models mid-conversation asks first.
 */
export function useModelChange({
  sessionId,
  session,
  setSession,
  events,
  busyAgent,
  warnModelChange,
}: {
  sessionId: string
  session: AgentSessionInfo | null
  setSession: (session: AgentSessionInfo) => void
  events: AgentEvent[]
  busyAgent: boolean
  warnModelChange: boolean
}) {
  const [pendingSettings, setPendingSettings] = useState<AgentSettings | null>(null)
  // While the agent is working, a model change takes effect right away and the run continues with the new settings.
  // The model bar hands over one change when the slider is released. While the agent is working it is applied straight away.
  const [modelWarning, setModelWarning] = useState<AgentSettings | null>(null)
  const [dontWarn, setDontWarn] = useState(false)
  // Another model has no cached copy of this conversation, so the first message after a switch is billed in full.
  const changeSettings = (next: AgentSettings) => {
    const current = pendingSettings ?? session?.settings
    const switching =
      !!current &&
      (current.provider !== next.provider || current.model !== next.model) &&
      !(current.provider === next.provider && !current.model)
    if (switching && warnModelChange && events.some((event) => event.kind === 'user')) {
      setDontWarn(false)
      setModelWarning(next)
      return
    }
    applySettings(next)
  }
  const applySettings = (next: AgentSettings) => {
    setPendingSettings(next)
    if (!busyAgent) return
    void invoke('agent.configure', sessionId, next).then(
      (updated) => {
        setSession(updated)
        setPendingSettings((current) => (current === next ? null : current))
      },
      (error) => {
        setPendingSettings(null)
        notifyError(errorText(error), 'Model')
      },
    )
  }
  return {
    pendingSettings,
    setPendingSettings,
    modelWarning,
    setModelWarning,
    dontWarn,
    setDontWarn,
    changeSettings,
    applySettings,
  }
}
