import { useCallback, useEffect, useRef, useState } from 'react'
import type { CloneStep } from '@ramu/shared/workspace/hostFolders'
import { invokerFor } from '../ipc'

const newCloneId = () => `clone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/**
 * One clone at a time on a host, with its progress and a way to stop it.
 */
export function useClone(host: string) {
  const [progress, setProgress] = useState<CloneStep | null>(null)
  const [running, setRunning] = useState(false)
  const active = useRef<{ id: string; host: string } | null>(null)
  useEffect(() => () => void (active.current = null), [])

  const run = useCallback(
    async (parent: string, name: string, url: string): Promise<string> => {
      const invoke = invokerFor(host)
      const id = newCloneId()
      active.current = { id, host }
      setRunning(true)
      setProgress(null)
      const timer = setInterval(
        () =>
          void invoke('folders.cloneProgress', id).then(
            (next) => {
              if (active.current?.id === id) setProgress(next && { phase: next.phase, percent: next.percent })
            },
            () => {},
          ),
        800,
      )
      try {
        return await invoke('folders.clone', parent, name, url, id)
      } finally {
        clearInterval(timer)
        if (active.current?.id === id) {
          active.current = null
          setRunning(false)
          setProgress(null)
        }
      }
    },
    [host],
  )
  /** Stops the running clone; the host removes the folder it was filling. */
  const cancel = useCallback(() => {
    const current = active.current
    if (current) void invokerFor(current.host)('folders.cancelClone', current.id).catch(() => {})
  }, [])
  return { run, cancel, progress, running, canCancel: running && !!active.current }
}
