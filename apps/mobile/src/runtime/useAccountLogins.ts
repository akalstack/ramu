import { useEffect, useState } from 'react'
import type { AccountLogin } from '@ramu/shared/providers/providers'
import { useStore } from './store'

type Logins = Record<string, Record<string, AccountLogin>>

/**
 * Each host's logins by provider and account: sign-in email and whether it uses an API key, read while `enabled` and the
 * host is online, and again when a login or the list of logins changes, for naming logins that have no label. Hosts that
 * cannot answer name their logins by position.
 */
export function useAccountLogins(hostIds: string[], enabled = true): Record<string, Logins> {
  const store = useStore()
  const [logins, setLogins] = useState<Record<string, Logins>>({})
  const online = hostIds.filter((id) => store.isOnline(id))
  const key = online.join(',')
  useEffect(() => {
    if (!enabled || !online.length) return
    let live = true
    const read = (ids: string[]) =>
      void Promise.all(
        ids.map(async (id) => [id, await store.invoke(id, 'providers.accountLogins').catch(() => ({}))] as const),
      ).then((answers) => live && setLogins((current) => ({ ...current, ...Object.fromEntries(answers) })))
    read(online)
    // A login signed in elsewhere, or a login added on the host, is named here at once.
    const offs = online.map((id) =>
      store.subscribe(id, (...[channel]) => {
        if (channel === 'logins:changed' || channel === 'settings:changed') read([id])
      }),
    )
    return () => {
      live = false
      for (const off of offs) off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the online hosts; store.invoke is stable
  }, [key, enabled])
  return logins
}
