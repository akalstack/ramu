import { afterEach, expect, it, vi } from 'vitest'
import {
  completeOAuthCallback,
  HostOAuthProvider,
  lockedOAuthRecord,
  OAuthSignIn,
  revokeUpstream,
  type StoredOAuth,
} from '../src/mcp/oauth'

const open: OAuthSignIn[] = []
afterEach(() => {
  for (const sign of open.splice(0)) sign.cancel()
})

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

/** A fake MCP server plus authorization server: discovery, dynamic registration and the token endpoint. */
function fakeService(cimd = false) {
  const requests: string[] = []
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input)
    requests.push(`${init?.method ?? 'GET'} ${url.origin}${url.pathname}`)
    if (url.origin === 'https://mcp.example' && url.pathname.startsWith('/.well-known/oauth-protected-resource'))
      return json({ resource: 'https://mcp.example/mcp', authorization_servers: ['https://auth.example'] })
    if (url.origin === 'https://auth.example' && url.pathname.startsWith('/.well-known/'))
      return json({
        issuer: 'https://auth.example',
        authorization_endpoint: 'https://auth.example/authorize',
        token_endpoint: 'https://auth.example/token',
        registration_endpoint: 'https://auth.example/register',
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        ...(cimd ? { client_id_metadata_document_supported: true } : {}),
      })
    if (url.href === 'https://auth.example/register') {
      const body = JSON.parse(String(init?.body))
      return json({ ...body, client_id: 'ramu-client' }, 201)
    }
    if (url.href === 'https://auth.example/token')
      return json({ access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'Bearer', expires_in: 3600 })
    return json({}, 404)
  })
  return { fetch, requests }
}

function start(
  overrides: {
    current?: () => boolean
    clientId?: string
    cimd?: boolean
    metadataUrl?: string
    redirectUrl?: string
  } = {},
) {
  const service = fakeService(overrides.cimd)
  const completed: StoredOAuth[] = []
  const failures: string[] = []
  const sign = new OAuthSignIn({
    stillCurrent: overrides.current ?? (() => true),
    serverUrl: 'https://mcp.example/mcp',
    fetch: service.fetch as never,
    clientId: overrides.clientId,
    clientMetadataUrl: overrides.metadataUrl,
    redirectUrl: overrides.redirectUrl,
    complete: async (record) => {
      completed.push(record)
    },
    failed: (reason) => failures.push(reason),
    close: () => {},
  })
  open.push(sign)
  return { sign, completed, failures, service }
}

const callbackOf = (authorization: string) => {
  const url = new URL(authorization)
  return { redirect: new URL(url.searchParams.get('redirect_uri')!), state: url.searchParams.get('state')! }
}

it('offers an HTTPS sign-in page with PKCE and a state, then stores tokens only after a matching callback', async () => {
  const { sign, completed, service } = start()
  const result = await sign.begin()
  const authorization = new URL(result!.url)
  expect(authorization.origin).toBe('https://auth.example')
  expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
  expect(authorization.searchParams.get('code_challenge')).toBeTruthy()
  expect(authorization.searchParams.get('resource')).toBe('https://mcp.example/mcp')
  const { redirect, state } = callbackOf(result!.url)
  expect(redirect.hostname).toBe('127.0.0.1')

  const forged = await fetch(`${redirect.origin}/callback?code=stolen&state=forged`)
  expect(forged.status).toBe(400)
  expect(completed).toEqual([])

  const ok = await fetch(`${redirect.origin}/callback?code=abc&state=${state}`)
  expect(ok.status).toBe(200)
  expect(completed).toHaveLength(1)
  expect(completed[0]!.tokens?.refresh_token).toBe('refresh-1')
  expect(completed[0]!.clientInformation?.client_id).toBe('ramu-client')
  expect(service.requests).toContain('POST https://auth.example/token')

  // The transaction is one-time: a replay of the same callback finds nothing to complete.
  expect(
    (await fetch(`${redirect.origin}/callback?code=abc&state=${state}`).catch(() => ({ status: 400 }))).status,
  ).toBe(400)
  expect(completed).toHaveLength(1)
})

it('signs in with a pre-registered client ID and never registers dynamically', async () => {
  const { sign, completed, service } = start({ clientId: 'issued-for-ramu' })
  const result = await sign.begin()
  expect(new URL(result!.url).searchParams.get('client_id')).toBe('issued-for-ramu')
  const { redirect, state } = callbackOf(result!.url)
  expect((await fetch(`${redirect.origin}/callback?code=abc&state=${state}`)).status).toBe(200)
  expect(completed[0]!.clientInformation?.client_id).toBe('issued-for-ramu')
  expect(service.requests).not.toContain('POST https://auth.example/register')
})

it('finishes from a pasted redirect address, once, and refuses a wrong state', async () => {
  const { sign, completed } = start()
  const result = await sign.begin()
  const { redirect, state } = callbackOf(result!.url)
  expect(await sign.completeFrom('not an address')).toBe(false)
  expect(await sign.completeFrom(`${redirect.origin}/callback?code=abc&state=forged`)).toBe(false)
  expect(completed).toEqual([])
  expect(await sign.completeFrom(`  ${redirect.origin}/callback?code=abc&state=${state}  `)).toBe(true)
  expect(completed).toHaveLength(1)
  expect(await sign.completeFrom(`${redirect.origin}/callback?code=abc&state=${state}`)).toBe(false)
  expect(completed).toHaveLength(1)
})

it('uses a published client metadata document as the client ID only where the server supports one', async () => {
  const url = 'https://ramu.example/oauth/client.json'
  const supported = start({ cimd: true, metadataUrl: url })
  const first = await supported.sign.begin()
  expect(new URL(first!.url).searchParams.get('client_id')).toBe(url)
  expect(supported.service.requests).not.toContain('POST https://auth.example/register')
  const unsupported = start({ cimd: false, metadataUrl: url })
  const second = await unsupported.sign.begin()
  expect(new URL(second!.url).searchParams.get('client_id')).toBe('ramu-client')
  expect(unsupported.service.requests).toContain('POST https://auth.example/register')
})

it('finishes from a redirect to the host’s own address with no listener and nothing pasted, once, by state', async () => {
  const redirect = 'https://studio.example/mcp/oauth/callback'
  const { sign, completed } = start({ redirectUrl: redirect })
  const result = await sign.begin()
  const authorization = new URL(result!.url)
  expect(authorization.searchParams.get('redirect_uri')).toBe(redirect)
  const state = authorization.searchParams.get('state')!
  const through = (query: string) => completeOAuthCallback(new URL(`${redirect}?${query}`))
  expect((await through('code=abc&state=forged')).ok).toBe(false)
  expect((await through('code=abc')).ok).toBe(false)
  expect(completed).toEqual([])
  expect((await through(`code=abc&state=${state}`)).ok).toBe(true)
  expect(completed).toHaveLength(1)
  // The transaction is consumed: the same redirect replayed finds nothing.
  expect((await through(`code=abc&state=${state}`)).ok).toBe(false)
  expect(completed).toHaveLength(1)
})

it('refuses a callback once the connection changed or the sign-in was cancelled', async () => {
  let current = true
  const changed = start({ current: () => current })
  const result = await changed.sign.begin()
  const { redirect, state } = callbackOf(result!.url)
  current = false
  expect((await fetch(`${redirect.origin}/callback?code=abc&state=${state}`)).status).toBe(400)
  expect(changed.completed).toEqual([])
  expect(changed.failures).toEqual(['The connection changed during sign-in.'])

  const cancelled = start()
  const second = await cancelled.sign.begin()
  const target = callbackOf(second!.url)
  cancelled.sign.cancel()
  const late = await fetch(`${target.redirect.origin}/callback?code=abc&state=${target.state}`).catch(() => ({
    status: 400,
  }))
  expect(late.status).toBe(400)
  expect(cancelled.completed).toEqual([])
  expect(cancelled.failures).toEqual(['Sign-in was cancelled.'])
})

const sharedRecord = (initial: StoredOAuth, key = 'connection') => {
  const state = { record: initial }
  const store = () =>
    lockedOAuthRecord(
      key,
      async () => structuredClone(state.record),
      async (value) => {
        // A slow keychain write, so interleaving would show up if the lock did not hold.
        await new Promise((resolve) => setTimeout(resolve, 5))
        state.record = value
      },
    )
  return { state, store }
}

it('uses and refreshes stored tokens in the background but never starts a sign-in on its own', async () => {
  const { state, store } = sharedRecord({ tokens: { access_token: 'a', token_type: 'Bearer', refresh_token: 'r' } })
  const provider = new HostOAuthProvider(store())
  expect((await provider.tokens())?.access_token).toBe('a')
  await provider.saveTokens({ access_token: 'b', token_type: 'Bearer', refresh_token: 'r2' })
  expect(state.record.tokens?.access_token).toBe('b')
  expect(() => provider.redirectToAuthorization(new URL('https://auth.example/authorize'))).toThrow('Settings')
  await provider.invalidateCredentials('tokens')
  expect(state.record.tokens).toBeUndefined()
})

it('does not let a stale provider clear tokens another one just refreshed, nor lose a concurrent save', async () => {
  const { state, store } = sharedRecord(
    { tokens: { access_token: 'a', token_type: 'Bearer', refresh_token: 'r1' }, clientInformation: { client_id: 'c' } },
    'race',
  )
  const first = new HostOAuthProvider(store())
  const second = new HostOAuthProvider(store())
  await first.tokens()
  await second.tokens()
  // The first refreshes and rotates; the second, still holding the old refresh token, is told it is invalid.
  await first.saveTokens({ access_token: 'b', token_type: 'Bearer', refresh_token: 'r2' })
  await second.invalidateCredentials('tokens')
  expect(state.record.tokens?.refresh_token).toBe('r2')
  await Promise.all([
    first.saveClientInformation({ client_id: 'c2' }),
    second.saveTokens({ access_token: 'c', token_type: 'Bearer', refresh_token: 'r3' }),
  ])
  expect(state.record.clientInformation?.client_id).toBe('c2')
  expect(state.record.tokens?.refresh_token).toBe('r3')
})

/** A service whose authorization server may or may not offer revocation, and may refuse it. */
function revocableService(options: { revocation?: string | null; status?: number }) {
  const revoked: { token: string; hint: string; client: string | null }[] = []
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input)
    if (url.origin === 'https://mcp.example' && url.pathname.startsWith('/.well-known/oauth-protected-resource'))
      return json({ resource: 'https://mcp.example/mcp', authorization_servers: ['https://auth.example'] })
    if (url.origin === 'https://auth.example' && url.pathname.startsWith('/.well-known/'))
      return json({
        issuer: 'https://auth.example',
        authorization_endpoint: 'https://auth.example/authorize',
        token_endpoint: 'https://auth.example/token',
        response_types_supported: ['code'],
        ...(options.revocation === null
          ? {}
          : { revocation_endpoint: options.revocation ?? 'https://auth.example/revoke' }),
      })
    if (url.pathname === '/revoke') {
      const body = new URLSearchParams(String(init?.body))
      revoked.push({ token: body.get('token')!, hint: body.get('token_type_hint')!, client: body.get('client_id') })
      return new Response(null, { status: options.status ?? 200 })
    }
    return json({}, 404)
  })
  return { fetch: fetch as never, revoked }
}
const signedIn: StoredOAuth = {
  tokens: { access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'Bearer' },
  clientInformation: { client_id: 'ramu-client', redirect_uris: [] },
}

it('asks the service to revoke the refresh and access tokens Ramu holds, with only the token and client id', async () => {
  const service = revocableService({})
  expect(await revokeUpstream(signedIn, 'https://mcp.example/mcp', service.fetch)).toBe('revoked')
  expect(service.revoked).toEqual([
    { token: 'refresh-1', hint: 'refresh_token', client: 'ramu-client' },
    { token: 'access-1', hint: 'access_token', client: 'ramu-client' },
  ])
})

it('says when nothing was signed in, the service offers no revocation, or it refused', async () => {
  expect(await revokeUpstream({}, 'https://mcp.example/mcp', revocableService({}).fetch)).toBe('none')
  expect(await revokeUpstream(signedIn, 'https://mcp.example/mcp', revocableService({ revocation: null }).fetch)).toBe(
    'unsupported',
  )
  // A revocation endpoint that is not HTTPS is never contacted.
  const plain = revocableService({ revocation: 'http://auth.example/revoke' })
  expect(await revokeUpstream(signedIn, 'https://mcp.example/mcp', plain.fetch)).toBe('unsupported')
  expect(plain.revoked).toEqual([])
  expect(await revokeUpstream(signedIn, 'https://mcp.example/mcp', revocableService({ status: 500 }).fetch)).toBe(
    'failed',
  )
  const down = vi.fn(async () => {
    throw new Error('offline')
  })
  expect(await revokeUpstream(signedIn, 'https://mcp.example/mcp', down as never)).toBe('failed')
})
