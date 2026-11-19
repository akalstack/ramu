import { useEffect, useState } from 'react'
import type { UsageReading } from '@ramu/shared/types'
import { useStore } from './store'

/** Every login's usage readings on one host, read while `enabled` and the host is online, and again when usage changes. */
export function useAccountUsage(hostId: string, enabled = true): UsageReading[] {
  const store = useStore()
  const [readings, setReadings] = useState<UsageReading[]>([])
  const online = store.isOnline(hostId)
  useEffect(() => {
    if (!enabled || !online) return
    let live = true
    const read = () =>
      void store
        .invoke(hostId, 'usage.accounts')
        .then((next) => live && setReadings(next))
        .catch(() => {})
    read()
    const off = store.subscribe(hostId, (...[channel]) => {
      if (channel === 'usage:changed' || channel === 'logins:changed') read()
    })
    return () => {
      live = false
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the host and whether it is reachable; store.invoke is stable
  }, [hostId, enabled, online])
  return readings
}
