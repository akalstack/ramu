import { useCallback, useEffect, useRef, useState } from 'react'
import { invokerFor } from '../ipc'

export interface CloneProgress {
  phase: string
  percent: number | null
}

const newCloneId = () => `clone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/**
 * One clone at a time on a host, with its progress and a way to stop it. A host that predates progress and cancel
 * clones as before, with no progress to show.
 */
export function useClone(host: string) {
  const [progress, setProgress] = useState<CloneProgress | null>(null)
  const [running, setRunning] = useState(false)
  const active = useRef<{ id: string; host: string; cancellable: boolean } | null>(null)
  useEffect(() => () => void (active.current = null), [])

  const run = useCallback(
    async (parent: string, name: string, url: string): Promise<string> => {
      const invoke = invokerFor(host)
      // Only a host that answers the progress call also understands the clone id.
      const cancellable = await invoke('folders.cloneProgress', 'probe-unused-id').then(
        () => true,
        () => false,
      )
      const id = newCloneId()
      active.current = { id, host, cancellable }
      setRunning(true)
      setProgress(null)
      const timer = cancellable
        ? setInterval(
            () =>
              void invoke('folders.cloneProgress', id).then(
                (next) => {
                  if (active.current?.id === id) setProgress(next && { phase: next.phase, percent: next.percent })
                },
                () => {},
              ),
            800,
          )
        : undefined
      try {
        return await (cancellable
          ? invoke('folders.clone', parent, name, url, id)
          : invoke('folders.clone', parent, name, url))
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
    if (current?.cancellable) void invokerFor(current.host)('folders.cancelClone', current.id).catch(() => {})
  }, [])
  return { run, cancel, progress, running, canCancel: running && !!active.current?.cancellable }
}

/** `Receiving objects 60%`, or just the phase while Git has not reported a percentage. */
export const cloneProgressText = (progress: CloneProgress | null, t: (key: string) => string): string =>
  progress ? `${t(progress.phase)}${progress.percent === null ? '' : ` ${progress.percent}%`}` : t('Cloning…')
