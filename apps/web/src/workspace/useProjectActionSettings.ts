import { useEffect, useState } from 'react'
import type { ProjectActionSettings } from '@ramu/shared/types'
import { useHost } from './HostProvider'
import { useHostRuntime } from './workspace'
import { PROJECT_ACTIONS_EVENT } from './useProjectActions'
import { errorText } from '../lib/errors'

const empty: ProjectActionSettings = { actions: [], hiddenIds: [], customOrder: false }

/** Fetch management metadata only while its dialog is mounted; commands use the visible-only list. */
export function useProjectActionSettings(projectId: string) {
  const { id, invoke, status } = useHost()
  const runtime = useHostRuntime()
  const key = JSON.stringify([id, projectId])
  const [state, setState] = useState({ key, ...empty, supported: false, loading: true, error: '' })
  useEffect(() => {
    let current = true
    let generation = 0
    const load = async () => {
      const request = ++generation
      try {
        const settings = await invoke('projects.actionSettings', projectId)
        if (current && generation === request)
          setState({ key, ...settings, supported: true, loading: false, error: '' })
      } catch (reason) {
        if (!current || generation !== request) return
        setState({ key, ...empty, supported: false, loading: false, error: errorText(reason) })
      }
    }
    void load()
    const off = runtime.on('workspace:changed', () => void load())
    const changed = () => void load()
    window.addEventListener(PROJECT_ACTIONS_EVENT, changed)
    return () => {
      current = false
      off()
      window.removeEventListener(PROJECT_ACTIONS_EVENT, changed)
    }
  }, [key, projectId, invoke, runtime, status])
  return state.key === key ? state : { key, ...empty, supported: false, loading: true, error: '' }
}
