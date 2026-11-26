import { useCallback, useEffect, useRef, useState } from 'react'
import type { NetworkStatus } from '@ramu/shared/types'
import { workspaceVisible } from '../../workspace/workspaceLifetime'
import { useSettingsInvoke } from '../SettingsScope'

/** Polls while the screen is open: pairing happens on another device, so nothing here would otherwise know it finished. */
export function useNetworkStatus(interval: number) {
  const invoke = useSettingsInvoke()
  const [status, setStatus] = useState<NetworkStatus | null>(null)
  const loading = useRef(false)
  const reload = useCallback(async () => {
    if (!workspaceVisible() || loading.current) return
    loading.current = true
    try {
      setStatus(await invoke('network.status'))
    } catch {
    } finally {
      loading.current = false
    }
  }, [invoke])
  useEffect(() => {
    void reload()
    const id = window.setInterval(() => void reload(), interval)
    return () => window.clearInterval(id)
  }, [reload, interval])
  return [status, setStatus, reload] as const
}
