// Ramu Link on the phone: the account that finds hosts linked to it, the pinned key of each host, and the transport
// that reaches `.link.invalid` addresses through sealed relay streams. Every other address uses Expo's fetch as before.
import { useEffect, useState } from 'react'
import * as SecureStore from 'expo-secure-store'
import { fetch as expoFetch } from 'expo/fetch'
import { linkFetch, linkSocketFactory, type LinkClientOptions } from '@ramu/shared/link/client'
import {
  linkHosts,
  linkMe,
  signOutLink,
  startSignIn,
  waitForSignIn,
  type LinkHost,
  type SignInStart,
} from '@ramu/shared/link/account'
import { DEFAULT_LINK_SERVICE, isHostId, linkServiceUrl } from '@ramu/shared/link/protocol'
import type { SocketFactory } from '@ramu/client-runtime/socket'
import { readLinkStateText, saveLinkStateText } from '../storage'
import { secureRandom } from './secureRandom'

interface LinkState {
  service: string | null
  account: { name: string; email: string } | null
  pins: Record<string, string>
}
export interface LinkView {
  service: string | null
  account: LinkState['account']
  signIn: { userCode: string; url: string } | null
  error: string | null
}

const TOKEN_KEY = 'ramu.link.session'
const KEY = /^[0-9a-f]{64}$/

function load(): LinkState {
  try {
    const value = JSON.parse(readLinkStateText() ?? '{}') as Partial<LinkState>
    const pins: Record<string, string> = {}
    for (const [hostId, key] of Object.entries(value.pins ?? {}))
      if (isHostId(hostId) && typeof key === 'string' && KEY.test(key)) pins[hostId] = key
    return {
      service: typeof value.service === 'string' ? value.service : null,
      account:
        value.account && typeof value.account.email === 'string' && typeof value.account.name === 'string'
          ? value.account
          : null,
      pins,
    }
  } catch {
    return { service: null, account: null, pins: {} }
  }
}

let state = load()
let token: string | null = null
let tokenLoaded: Promise<void> | null = null
let pending: { start: SignInStart; abort: AbortController } | null = null
let error: string | null = null
let random: ((bytes: number) => Uint8Array) | null = null
void secureRandom().then((source) => (random = source))
const listeners = new Set<() => void>()

const save = () => saveLinkStateText(JSON.stringify(state))
const notify = () => {
  for (const listener of [...listeners]) listener()
}
const loadToken = () =>
  (tokenLoaded ??= SecureStore.getItemAsync(TOKEN_KEY).then(
    (value) => void (token = value),
    () => {},
  ))
const service = () => state.service ?? DEFAULT_LINK_SERVICE
const fetcher = expoFetch as unknown as typeof globalThis.fetch

const client: LinkClientOptions = {
  account: async () => {
    await loadToken()
    const url = service()
    return url && token ? { service: url, token } : null
  },
  pinned: (hostId) => state.pins[hostId] ?? null,
  random: (bytes) => {
    if (!random) throw new Error('This build cannot use Ramu Link. Update Ramu and try again.')
    return random(bytes)
  },
}

/** `fetch` for host addresses: Link addresses through a sealed stream, the rest through Expo's fetch. */
export const hostFetch = linkFetch(client, fetcher)
/** Wraps the phone's WebSocket factory so Link addresses open sealed streams. */
export const linkAware = (factory: SocketFactory): SocketFactory => linkSocketFactory(client, factory)

/** Pins the Link key a host vouched for (in a pairing answer or a proven identity answer). */
export function pinLinkKey(hostId: string | undefined, key: string | undefined) {
  if (!hostId || !key || !isHostId(hostId) || !KEY.test(key) || state.pins[hostId] === key) return
  state = { ...state, pins: { ...state.pins, [hostId]: key } }
  save()
}

const view = (): LinkView => ({
  service: service(),
  account: state.account,
  signIn: pending ? { userCode: pending.start.userCode, url: pending.start.url } : null,
  error,
})

export function setLinkService(input: string | null) {
  if (state.account) throw new Error('Sign out of Ramu Link before changing the service')
  state = { ...state, service: input === null || input.trim() === '' ? null : linkServiceUrl(input) }
  save()
  notify()
}

/** Starts the device-code sign-in and returns the page to open; it finishes on its own once approved there. */
export async function signInToLink(): Promise<string> {
  const url = service()
  if (!url) throw new Error('Enter the Ramu Link service first')
  pending?.abort.abort()
  const start = await startSignIn(fetcher, url, 'ramu-mobile')
  const abort = new AbortController()
  pending = { start, abort }
  error = null
  notify()
  void waitForSignIn(fetcher, url, 'ramu-mobile', start, abort.signal)
    .then(async (session) => {
      const me = await linkMe(fetcher, url, session)
      await SecureStore.setItemAsync(TOKEN_KEY, session)
      token = session
      state = { ...state, service: url, account: me.user }
      save()
    })
    .catch((reason: unknown) => {
      if (!abort.signal.aborted) error = reason instanceof Error ? reason.message : String(reason)
    })
    .finally(() => {
      if (pending?.abort === abort) pending = null
      notify()
    })
  return start.url
}

export function cancelLinkSignIn() {
  pending?.abort.abort()
  pending = null
  notify()
}

export async function signOutOfLink() {
  await loadToken()
  const url = service()
  if (url && token) await signOutLink(fetcher, url, token)
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {})
  token = null
  state = { ...state, account: null }
  save()
  notify()
}

export async function accountHosts(): Promise<LinkHost[]> {
  await loadToken()
  const url = service()
  if (!url || !token) return []
  return (await linkHosts(fetcher, url, token)).hosts
}

export function useLinkAccount(): LinkView {
  const [current, setCurrent] = useState(view)
  useEffect(() => {
    const update = () => setCurrent(view())
    listeners.add(update)
    update()
    return () => void listeners.delete(update)
  }, [])
  return current
}
