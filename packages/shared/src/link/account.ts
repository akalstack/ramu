// Talking to a Ramu Link service's account API. Every client signs in with the device-code flow: it shows a short code
// and a link, the person approves on any device, and the client keeps polling until it holds a session token.
import { LINK_PATHS } from './protocol'

type Fetch = typeof fetch
export type LinkClientId = 'ramu-host' | 'ramu-desktop' | 'ramu-mobile'

export interface SignInStart {
  deviceCode: string
  userCode: string
  /** Opens the approval page with the code filled in. */
  url: string
  expiresAt: number
  intervalMs: number
}
export type SignInPoll =
  { state: 'pending'; intervalMs: number } | { state: 'approved'; token: string } | { state: 'denied' | 'expired' }

export interface LinkHost {
  hostId: string
  name: string
  publicKey: string
  online: boolean
  lastSeenAt: number | null
}
export interface LinkMe {
  user: { name: string; email: string }
  hosts: number
  limit: number | null
}

export class LinkApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const withTimeout = (signal?: AbortSignal) =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000)

async function call<T>(
  fetcher: Fetch,
  service: string,
  path: string,
  init: { method?: string; token?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetcher(new URL(path, service).toString(), {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: withTimeout(init.signal),
  })
  const value = (await response.json().catch(() => ({}))) as T & { error?: unknown; message?: unknown }
  if (!response.ok) {
    const message =
      typeof value.error === 'string' ? value.error : typeof value.message === 'string' ? value.message : undefined
    throw new LinkApiError(
      response.status === 401 ? 'Sign in to Ramu Link again.' : (message ?? `Ramu Link answered ${response.status}`),
      response.status,
    )
  }
  return value
}

export async function startSignIn(fetcher: Fetch, service: string, clientId: LinkClientId): Promise<SignInStart> {
  const answer = await call<{
    device_code: string
    user_code: string
    verification_uri_complete?: string
    verification_uri: string
    expires_in: number
    interval?: number
  }>(fetcher, service, '/api/auth/device/code', { method: 'POST', body: { client_id: clientId } })
  return {
    deviceCode: answer.device_code,
    userCode: answer.user_code,
    url: new URL(answer.verification_uri_complete ?? answer.verification_uri, service).toString(),
    expiresAt: Date.now() + answer.expires_in * 1000,
    intervalMs: Math.max(1, answer.interval ?? 5) * 1000,
  }
}

export async function pollSignIn(
  fetcher: Fetch,
  service: string,
  clientId: LinkClientId,
  deviceCode: string,
  intervalMs: number,
): Promise<SignInPoll> {
  const response = await fetcher(new URL('/api/auth/device/token', service).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: clientId,
    }),
    signal: AbortSignal.timeout(20_000),
  })
  const value = (await response.json().catch(() => ({}))) as { access_token?: unknown; error?: unknown }
  if (response.ok && typeof value.access_token === 'string') return { state: 'approved', token: value.access_token }
  if (value.error === 'authorization_pending') return { state: 'pending', intervalMs }
  if (value.error === 'slow_down') return { state: 'pending', intervalMs: intervalMs + 5000 }
  if (value.error === 'access_denied') return { state: 'denied' }
  if (value.error === 'expired_token') return { state: 'expired' }
  throw new LinkApiError(`Ramu Link answered ${response.status}`, response.status)
}

/** Polls until approved, denied, expired or aborted. */
export async function waitForSignIn(
  fetcher: Fetch,
  service: string,
  clientId: LinkClientId,
  start: SignInStart,
  signal: AbortSignal,
): Promise<string> {
  let interval = start.intervalMs
  while (!signal.aborted) {
    if (Date.now() > start.expiresAt) throw new LinkApiError('The sign-in code expired. Start again.', 410)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, interval)
      signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true })
    })
    if (signal.aborted) break
    const poll = await pollSignIn(fetcher, service, clientId, start.deviceCode, interval).catch((error: unknown) => {
      // A dropped request while waiting is not a refusal; try again at the next interval.
      if (error instanceof LinkApiError && error.status >= 500)
        return { state: 'pending' as const, intervalMs: interval }
      if (error instanceof LinkApiError) throw error
      return { state: 'pending' as const, intervalMs: interval }
    })
    if (poll.state === 'approved') return poll.token
    if (poll.state === 'denied') throw new LinkApiError('Sign-in was denied.', 403)
    if (poll.state === 'expired') throw new LinkApiError('The sign-in code expired. Start again.', 410)
    if (poll.state === 'pending') interval = poll.intervalMs
  }
  throw new LinkApiError('Sign-in was cancelled.', 499)
}

export const linkMe = (fetcher: Fetch, service: string, token: string) =>
  call<LinkMe>(fetcher, service, LINK_PATHS.me, { token })
export const linkHosts = (fetcher: Fetch, service: string, token: string) =>
  call<{ hosts: LinkHost[]; limit: number | null }>(fetcher, service, LINK_PATHS.hosts, { token })
export const registerLinkHost = (
  fetcher: Fetch,
  service: string,
  token: string,
  host: { hostId: string; name: string; publicKey: string },
) => call<{ secret: string }>(fetcher, service, LINK_PATHS.hosts, { method: 'POST', token, body: host })
export const unlinkHost = (fetcher: Fetch, service: string, token: string, hostId: string) =>
  call<{ removed: boolean }>(fetcher, service, LINK_PATHS.host(hostId), { method: 'DELETE', token })
export const signOutLink = (fetcher: Fetch, service: string, token: string) =>
  call<unknown>(fetcher, service, '/api/auth/sign-out', { method: 'POST', token, body: {} }).catch(() => undefined)
export const deleteLinkAccount = (fetcher: Fetch, service: string, token: string) =>
  call<{ deleted: boolean }>(fetcher, service, LINK_PATHS.me, { method: 'DELETE', token })
