import { useEffect, useState } from 'react'
import type { ProjectAction } from '@ramu/shared/types'
import { useHost } from './HostProvider'
import { useHostRuntime } from './workspace'

export const PROJECT_ACTIONS_EVENT = 'ramu:project-actions'

/** The project's saved actions, refreshed whenever any window-bar control changes them. */
export function useProjectActions(projectId?: string) {
  const { id, invoke, status } = useHost()
  const runtime = useHostRuntime()
  const key = JSON.stringify([id, projectId])
  const [state, setState] = useState<{ key: string; actions: ProjectAction[] }>({ key, actions: [] })
  useEffect(() => {
    let current = true
    let generation = 0
    const load = () => {
      const request = ++generation
      if (!projectId) return setState({ key, actions: [] })
      void invoke('projects.actions', projectId).then(
        (actions) => {
          if (current && generation === request) setState({ key, actions })
        },
        () => {
          if (current && generation === request) setState({ key, actions: [] })
        },
      )
    }
    load()
    const off = runtime.on('workspace:changed', load)
    window.addEventListener(PROJECT_ACTIONS_EVENT, load)
    return () => {
      current = false
      off()
      window.removeEventListener(PROJECT_ACTIONS_EVENT, load)
    }
  }, [key, projectId, invoke, runtime, status])
  return state.key === key ? state.actions : []
}
