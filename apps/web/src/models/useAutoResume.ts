import { useCallback } from 'react'
import { autoResumeOverride, type AutoResumeChoice } from '@ramu/shared/chat/limitPolicy'
import type { AgentSessionInfo, AgentSettings } from '@ramu/shared/types'
import { useHost } from '../workspace/HostProvider'
import { useAppSettings } from '../settings/AppSettings'
import { autoResumeControl, type AutoResumeControl } from './autoResumeMenu'

/**
 * The per-thread Auto-resume control for the tray and the provider chip. Choosing an item sets or clears the thread's
 * override on the server, which clears or re-arms the wait at once, and the returned session replaces the local one.
 */
export function useAutoResume(
  sessionId: string,
  settings: Pick<AgentSettings, 'autoResume'>,
  onSession: (session: AgentSessionInfo) => void,
  onError: (reason: unknown) => void,
): AutoResumeControl {
  const { preferences } = useAppSettings()
  const { invoke } = useHost()
  const set = useCallback(
    (choice: AutoResumeChoice) => {
      invoke('agent.setAutoResume', sessionId, autoResumeOverride(choice)).then(onSession, onError)
    },
    [sessionId, onSession, onError, invoke],
  )
  return autoResumeControl(settings, preferences.fallback, set)
}
