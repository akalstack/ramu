import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { AccountHostConnector } from '@ramu/shared/accountHosts'
import { translate } from '@ramu/shared/i18n'
import { accountUser, listedHosts } from '../runtime/account'
import { useStore } from '../runtime/store'
import { showToast } from '../runtime/toast'

const ADDED = 'ramu-account-hosts-added'
let mounted: AccountHostConnector | null = null

/** Adds the account's hosts now, as after signing in on the Account screen, rather than when the app next comes back. */
export const connectAccountHosts = () => void mounted?.connect()

/**
 * Adds the hosts listed in this phone's Ramu account that let the account's devices in, with no tap: when the app
 * starts, comes to the front, or signs in. Each is added once, so a host forgotten on this phone stays forgotten.
 */
export function AccountHosts() {
  const store = useStore()
  const latest = useRef(store)
  latest.current = store
  const added = useRef(new Set<string>())
  const connector = useRef<AccountHostConnector | null>(null)
  connector.current ??= new AccountHostConnector({
    hosts: async () => ((await accountUser()) ? listedHosts() : []),
    saved: (hostKey) => latest.current.computers.some((computer) => computer.hostId === hostKey),
    added: {
      has: (id) => added.current.has(id),
      add: (id) => {
        added.current.add(id)
        void SecureStore.setItemAsync(ADDED, JSON.stringify([...added.current])).catch(() => {})
      },
    },
    pair: async (host) => {
      await latest.current.pairThroughAccount(host.name, host.id, () => {}, AbortSignal.timeout(60_000))
      showToast(
        translate(latest.current.language, 'Connected to {name} through your Ramu account.', { name: host.name }),
      )
    },
  })
  useEffect(() => {
    if (!store.ready) return
    const connector_ = connector.current!
    mounted = connector_
    let alive = true
    void SecureStore.getItemAsync(ADDED)
      .then((saved) => {
        const ids: unknown = saved ? JSON.parse(saved) : []
        if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') added.current.add(id)
      })
      .catch(() => {})
      .then(() => alive && void connector_.connect())
    const watch = AppState.addEventListener('change', (state) => {
      if (state === 'active') void connector_.connect()
    })
    return () => {
      alive = false
      if (mounted === connector_) mounted = null
      watch.remove()
    }
  }, [store.ready])
  return null
}
