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
