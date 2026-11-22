import { afterEach, expect, it, vi } from 'vitest'
import { LINK_LIMITS, LINK_URL, type LinkReply } from '@ramu/shared/ramuLink'
import { HostCredentialStore } from '../src/credentials/store'
import { LinkClient, parseRelay } from '../src/remote/ramuLink'

afterEach(() => vi.useRealTimers())

const usage = { bytes: 0, countedAt: 0 }

/** A relay that answers each POST with the next reply, and records every call. */
function relay(replies: LinkReply[]) {
  const calls: { method: string; path: string; body: unknown; auth: string | null }[] = []
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({
      method: init?.method ?? 'GET',
      path: url.pathname,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      auth: new Headers(init?.headers).get('authorization'),
    })
    if (url.pathname === '/v1/pool') return Response.json({ capacity: 950, used: 950, waiting: 3 })
    if (init?.method === 'POST' && url.pathname === '/v1/links') return Response.json(replies.shift())
    return new Response(null, { status: 204 })
  }) as typeof fetch
  return { calls, fetcher }
}

function client(fetcher: typeof fetch, bearer: string | null = 'session-token') {
  const state = new Map<string, unknown>()
  const vault = new Map<string, string>()
  const changed = vi.fn()
  const make = () =>
    new LinkClient({
      hostId: 'host-1',
      hostName: () => 'Studio Mac',
      bearer: async () => bearer,
      getState: (key, fallback) => (state.has(key) ? (structuredClone(state.get(key)) as never) : fallback),
      setState: (key, value) => void state.set(key, structuredClone(value)),
      changed,
      credentials: new HostCredentialStore(async (_service, key) => ({
        setPassword: async (value) => void vault.set(key, value),
        getPassword: async () => vault.get(key) ?? null,
        deletePassword: async () => vault.delete(key),
      })),
      fetch: fetcher,
    })
  return { link: make(), make, changed, vault }
}

it('asks the relay with the account session and the listener port, and keeps the token in the credential store', async () => {
  const { calls, fetcher } = relay([
    { state: 'active', hostname: 'ramu-abc.akalstack.com', token: 'tunnel-token', releasesAt: 99, usage },
  ])
  const { link, vault } = client(fetcher)
  const lease = await link.lease(LINK_URL, 'http://127.0.0.1:7788')
  expect(lease).toEqual({ token: 'tunnel-token', url: 'https://ramu-abc.akalstack.com' })
  expect(calls[0]).toMatchObject({
    method: 'POST',
    path: '/v1/links',
    auth: 'Bearer session-token',
    body: { hostId: 'host-1', name: 'Studio Mac', port: 7788, https: false },
  })
  expect([...vault.values()].join()).toContain('tunnel-token')
  expect(link.status()).toMatchObject({ state: 'active', hostname: 'ramu-abc.akalstack.com', releasesAt: 99 })
})

it('reconnects after a restart with the kept token before the relay answers, and follows a changed token', async () => {
  const first = relay([{ state: 'active', hostname: 'ramu-abc.akalstack.com', token: 'old', releasesAt: 1, usage }])
  const host = client(first.fetcher)
  await host.link.lease(LINK_URL, 'http://127.0.0.1:7788')
  let answer: (reply: Response) => void = () => {}
  const slow = (async () => new Promise<Response>((resolve) => (answer = resolve))) as typeof fetch
  const restarted = new LinkClient({ ...(host.link as unknown as { host: object }).host, fetch: slow } as never)
  const leased = vi.fn()
  restarted.onLease = leased
  expect(await restarted.lease(LINK_URL, 'http://127.0.0.1:7788')).toEqual({
    token: 'old',
    url: 'https://ramu-abc.akalstack.com',
  })
  answer(Response.json({ state: 'active', hostname: 'ramu-abc.akalstack.com', token: 'new', releasesAt: 2, usage }))
  await vi.waitFor(() => expect(leased).toHaveBeenCalledWith({ token: 'new', url: 'https://ramu-abc.akalstack.com' }))
})

it('waits on the list when every slot is taken and starts the tunnel when a later check finds one', async () => {
  vi.useFakeTimers()
  const { fetcher } = relay([
    { state: 'waitlisted', position: 4, capacity: 950 },
    { state: 'active', hostname: 'ramu-new.akalstack.com', token: 't', releasesAt: 5, usage },
  ])
  const { link } = client(fetcher)
  const leased = vi.fn()
  link.onLease = leased
  expect(await link.lease(LINK_URL, 'http://127.0.0.1:7788')).toBeNull()
  expect(link.status()).toMatchObject({ state: 'waitlisted', position: 4 })
  await vi.advanceTimersByTimeAsync(LINK_LIMITS.waitlistCheckMs)
  expect(leased).toHaveBeenCalledWith({ token: 't', url: 'https://ramu-new.akalstack.com' })
  expect(link.status().state).toBe('active')
})

it('says why there is no link: signed out, suspended, or the account’s slot is on another host', async () => {
  expect(await client(relay([]).fetcher, null).link.lease(LINK_URL, 'http://127.0.0.1:7788')).toBeNull()
  const suspended = client(relay([{ state: 'suspended', until: 7, usage }]).fetcher).link
  await suspended.lease(LINK_URL, 'http://127.0.0.1:7788')
  expect(suspended.status()).toMatchObject({ state: 'suspended', until: 7 })
  const taken = client(relay([{ state: 'taken', hostName: 'Office PC' }]).fetcher).link
  await taken.lease(LINK_URL, 'http://127.0.0.1:7788')
  expect(taken.status()).toMatchObject({ state: 'taken', takenBy: 'Office PC' })
  const signedOut = client(relay([]).fetcher, null).link
  await signedOut.lease(LINK_URL, 'http://127.0.0.1:7788')
  expect(signedOut.status().state).toBe('signed-out')
})

it('lets five devices use the link at once, reports use at most hourly, and releases the slot', async () => {
  const { calls, fetcher } = relay([
    { state: 'active', hostname: 'ramu-abc.akalstack.com', token: 't', releasesAt: 1, usage },
  ])
  const { link } = client(fetcher)
  await link.lease(LINK_URL, 'http://127.0.0.1:7788')
  for (let i = 0; i < LINK_LIMITS.devices; i++) expect(link.admit(`d${i}`)).toBe(true)
  expect(link.admit('d-extra')).toBe(false)
  expect(link.admit('d0')).toBe(true)
  link.leave('d1')
  expect(link.admit('d-extra')).toBe(true)
  await vi.waitFor(() => expect(calls.filter((call) => call.path.endsWith('/seen'))).toHaveLength(1))
  expect(link.routed('RAMU-ABC.akalstack.com:443')).toBe(true)
  expect(link.routed('192.168.1.5:7788')).toBe(false)
  await link.release()
  expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/v1/links/host-1' })
  expect(link.status()).toMatchObject({ hostname: null })
})

it('reads the pool once in a while and accepts only a well-formed answer', async () => {
  const { calls, fetcher } = relay([])
  const { link } = client(fetcher)
  expect(await link.pool(LINK_URL)).toEqual({ capacity: 950, used: 950, waiting: 3 })
  await link.pool(LINK_URL)
  expect(calls.filter((call) => call.path === '/v1/pool')).toHaveLength(1)
  expect(link.cachedPool()).toEqual({ capacity: 950, used: 950, waiting: 3 })
})

it('accepts a relay address with https and no path', () => {
  expect(parseRelay(undefined)).toBe(LINK_URL)
  expect(parseRelay('https://link.example.com/')).toBe('https://link.example.com')
  expect(parseRelay('http://localhost:8787')).toBe('http://localhost:8787')
  expect(() => parseRelay('http://link.example.com')).toThrow(/https/)
  expect(() => parseRelay('https://link.example.com/v1')).toThrow(/no path/)
})
