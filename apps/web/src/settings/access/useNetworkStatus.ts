import { useCallback, useEffect, useRef, useState } from 'react'
import type { NetworkStatus } from '@ramu/shared/types'
import { workspaceVisible } from '../../workspace/workspaceLifetime'
import { errorText } from '../../lib/errors'
import { useSettingsInvoke } from '../SettingsScope'

/**
 * Polls while the screen is open: pairing happens on another device, so nothing here would otherwise know it finished.
 * `error` is why the host refused the last read, such as another host that keeps its devices to itself.
 */
export function useNetworkStatus(interval: number) {
  const invoke = useSettingsInvoke()
  const [status, setStatus] = useState<NetworkStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loading = useRef(false)
  const reload = useCallback(async () => {
    if (!workspaceVisible() || loading.current) return
    loading.current = true
    try {
      setStatus(await invoke('network.status'))
      setError(null)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      loading.current = false
    }
  }, [invoke])
  useEffect(() => {
    void reload()
    const id = window.setInterval(() => void reload(), interval)
    return () => window.clearInterval(id)
  }, [reload, interval])
  return [status, setStatus, reload, error] as const
}
