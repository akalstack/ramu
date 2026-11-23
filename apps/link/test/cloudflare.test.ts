import { expect, it } from 'vitest'
import { cloudflare } from '../src/cloudflare'

it('calls fetch on its own, as the Workers runtime requires', async () => {
  const calls: string[] = []
  // Like the Workers runtime's fetch: called as a method of another object, it throws.
  const fetch = function (this: unknown, input: RequestInfo | URL) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation')
    calls.push(String(input))
    return Promise.resolve(Response.json({ success: true, result: { id: 'tunnel-1' } }))
  } as typeof globalThis.fetch
  const cf = cloudflare({ token: 't', accountId: 'a', zoneId: 'z', fetch })
  expect(await cf.createTunnel('ramu-x')).toBe('tunnel-1')
  await cf.bytesByHost(['ramu-x.example.com'], 0, 1)
  expect(calls).toEqual([
    'https://api.cloudflare.com/client/v4/accounts/a/cfd_tunnel',
    'https://api.cloudflare.com/client/v4/graphql',
  ])
})

it('takes over a DNS record a failed removal left behind, instead of failing on its name', async () => {
  const calls: string[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`)
    if (init?.method === 'POST')
      return Response.json(
        { success: false, errors: [{ code: 81053, message: 'Record already exists.' }] },
        { status: 400 },
      )
    if (!init?.method || init.method === 'GET') return Response.json({ success: true, result: [{ id: 'stale' }] })
    return Response.json({ success: true, result: { id: 'stale' } })
  }) as typeof globalThis.fetch
  const cf = cloudflare({ token: 't', accountId: 'a', zoneId: 'z', fetch })
  expect(await cf.putCname('ramu-x.example.com', 'tunnel.cfargotunnel.com', null)).toBe('stale')
  expect(calls).toEqual([
    'POST /client/v4/zones/z/dns_records',
    'GET /client/v4/zones/z/dns_records?type=CNAME&name=ramu-x.example.com',
    'PATCH /client/v4/zones/z/dns_records/stale',
  ])
})
