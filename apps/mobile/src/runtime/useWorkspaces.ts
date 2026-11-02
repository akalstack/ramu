import { useEffect, useState } from 'react'
import type { WorktreeWorkspace } from '@ramu/shared/types'
import { useStore } from './store'

/** Read the existing host catalog without creating a thread or allocating a checkout. */
export function useWorkspaces(host: string, enabled = true) {
  const store = useStore()
  const online = store.isOnline(host)
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{
    host: string
    rows: WorktreeWorkspace[]
    loading: boolean
    error: string
  }>({ host, rows: [], loading: enabled && online, error: '' })
  useEffect(() => {
    let alive = true
    setState({ host, rows: [], loading: enabled && online, error: '' })
    if (!enabled || !online) return
    const read = () => {
      void store.invoke(host, 'workspaces.list').then(
        (rows) => {
          if (alive) setState({ host, rows, loading: false, error: '' })
        },
        (error) => {
          if (alive)
            setState({
              host,
              rows: [],
              loading: false,
              error: String(error instanceof Error ? error.message : error),
            })
        },
      )
    }
    read()
    const off = store.subscribe(host, (channel) => {
      if (channel === 'workspace:changed') setRevision((value) => value + 1)
    })
    return () => {
      alive = false
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [host, enabled, online, revision] by design; the values it reads beyond these are current as of that run
  }, [host, enabled, online, revision])
  return {
    ...(state.host === host ? state : { host, rows: [], loading: enabled && online, error: '' }),
    refresh: () => setRevision((value) => value + 1),
  }
}
