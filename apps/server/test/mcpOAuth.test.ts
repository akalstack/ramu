import { afterEach, expect, it, vi } from 'vitest'
import { HostOAuthProvider, OAuthSignIn, type StoredOAuth } from '../src/mcp/oauth'

const open: OAuthSignIn[] = []
afterEach(() => {
  for (const sign of open.splice(0)) sign.cancel()
})

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

/** A fake MCP server plus authorization server: discovery, dynamic registration and the token endpoint. */
function fakeService() {
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

function start(overrides: { current?: () => boolean } = {}) {
  const service = fakeService()
  const completed: StoredOAuth[] = []
  const failures: string[] = []
  const sign = new OAuthSignIn({
    stillCurrent: overrides.current ?? (() => true),
    serverUrl: 'https://mcp.example/mcp',
    fetch: service.fetch as never,
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

it('uses and refreshes stored tokens in the background but never starts a sign-in on its own', async () => {
  let record: StoredOAuth = { tokens: { access_token: 'a', token_type: 'Bearer', refresh_token: 'r' } }
  const provider = new HostOAuthProvider({
    load: async () => structuredClone(record),
    save: async (next) => {
      record = next
    },
  })
  expect((await provider.tokens())?.access_token).toBe('a')
  await provider.saveTokens({ access_token: 'b', token_type: 'Bearer', refresh_token: 'r2' })
  expect(record.tokens?.access_token).toBe('b')
  expect(() => provider.redirectToAuthorization(new URL('https://auth.example/authorize'))).toThrow('Settings')
  await provider.invalidateCredentials('tokens')
  expect(record.tokens).toBeUndefined()
})
