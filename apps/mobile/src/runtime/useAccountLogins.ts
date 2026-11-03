import { useEffect, useState } from 'react'
import type { AccountLogin } from '@ramu/shared/providers/providers'
import { useStore } from './store'

type Logins = Record<string, Record<string, AccountLogin>>

/**
 * Each host's logins by provider and account: sign-in email and whether it uses an API key, read while `enabled` and the
 * host is online, for naming logins that have no label. Hosts that cannot answer name their logins by position.
 */
export function useAccountLogins(hostIds: string[], enabled = true): Record<string, Logins> {
  const store = useStore()
  const [logins, setLogins] = useState<Record<string, Logins>>({})
  const online = hostIds.filter((id) => store.isOnline(id))
  const key = online.join(',')
  useEffect(() => {
    if (!enabled || !online.length) return
    let live = true
    void Promise.all(
      online.map(async (id) => [id, await store.invoke(id, 'providers.accountLogins').catch(() => ({}))] as const),
    ).then((answers) => live && setLogins((current) => ({ ...current, ...Object.fromEntries(answers) })))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the online hosts; store.invoke is stable
  }, [key, enabled])
  return logins
}
