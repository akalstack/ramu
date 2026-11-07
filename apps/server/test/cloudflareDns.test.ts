import { expect, it } from 'vitest'
import { createCloudflareRecords } from '../src/workspace/deploy/cloudflareDns'

it('adds the records in the domain’s zone, replacing an A or CNAME there and keeping other TXT records', async () => {
  const calls: { method: string; path: string; body: unknown }[] = []
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input).replace('https://cf.test', '')
    calls.push({ method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(String(init.body)) : null })
    const result = path.startsWith('/zones?')
      ? [{ id: 'z1' }]
      : path.includes('type=CNAME')
        ? [{ id: 'old-cname' }]
        : path.includes('type=TXT')
          ? [{ id: 'other-txt' }]
          : {}
    return new Response(JSON.stringify({ success: true, result }))
  }) as typeof fetch
  const written = await createCloudflareRecords(
    'cf-dns-token-cf-dns-token',
    'www.shop.co.uk',
    [
      { type: 'CNAME', host: 'www.shop.co.uk', name: 'www', value: 'cname.vercel-dns.com' },
      { type: 'TXT', host: '_vercel.shop.co.uk', name: '_vercel', value: 'vc-domain-verify=abc' },
    ],
    { api: 'https://cf.test', fetch: fetcher },
  )
  expect(written).toBe(2)
  expect(calls[0]!.path).toBe('/zones?name=shop.co.uk')
  expect(calls.filter((call) => call.method !== 'GET')).toEqual([
    {
      method: 'PUT',
      path: '/zones/z1/dns_records/old-cname',
      body: { type: 'CNAME', name: 'www.shop.co.uk', content: 'cname.vercel-dns.com', ttl: 1, proxied: false },
    },
    {
      method: 'POST',
      path: '/zones/z1/dns_records',
      body: { type: 'TXT', name: '_vercel.shop.co.uk', content: 'vc-domain-verify=abc', ttl: 1, proxied: false },
    },
  ])
})
