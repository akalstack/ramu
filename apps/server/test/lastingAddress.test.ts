import { expect, it, vi } from 'vitest'
import { HostCredentialStore } from '../src/credentials/store'
import { LastingAddresses } from '../src/workspace/deploy/namedTunnel'

function setup(ports: number[]) {
  const state = new Map<string, unknown>()
  const vault = new Map<string, string>()
  const credentials = new HostCredentialStore(async (_service, key) => ({
    setPassword: async (value) => void vault.set(key, value),
    getPassword: async () => vault.get(key) ?? null,
    deletePassword: async () => vault.delete(key),
  }))
  const calls: { method: string; path: string; body: unknown }[] = []
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input).replace('https://cf.test', '')
    calls.push({ method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(String(init.body)) : null })
    const result =
      path === '/accounts'
        ? [{ id: 'acc' }]
        : path.startsWith('/zones?')
          ? [{ id: 'zone' }]
          : path.endsWith('/cfd_tunnel')
            ? { id: 'tun' }
            : path.endsWith('/dns_records')
              ? { id: 'rec' }
              : path.endsWith('/token')
                ? 'tunnel-token'
                : {}
    return new Response(JSON.stringify({ success: true, result }))
  }) as unknown as typeof fetch
  const addresses = new LastingAddresses({
    getState: (key, fallback) => (state.has(key) ? (state.get(key) as never) : fallback),
    setState: (key, value) => void state.set(key, value),
    credentials,
    fetch: fetcher,
    api: 'https://cf.test',
    reserved: () => [4100],
    freePort: async () => ports.shift()!,
  })
  return { addresses, calls }
}

it('makes a tunnel that answers only the hostname at one port, never Ramu’s own, with its DNS record', async () => {
  const { addresses, calls } = setup([4100, 5555])
  expect(await addresses.set('p', { hostname: 'Demo.Example.com.', token: 'cf-token-cf-token-cf-token' })).toEqual({
    hostname: 'demo.example.com',
    port: 5555,
  })
  expect(calls.find((call) => call.path.endsWith('/configurations'))?.body).toEqual({
    config: {
      ingress: [{ hostname: 'demo.example.com', service: 'http://127.0.0.1:5555' }, { service: 'http_status:404' }],
    },
  })
  expect(calls.find((call) => call.path === '/zones/zone/dns_records')?.body).toEqual({
    type: 'CNAME',
    name: 'demo.example.com',
    content: 'tun.cfargotunnel.com',
    proxied: true,
  })
  expect(calls.find((call) => call.path.startsWith('/zones?'))?.path).toBe('/zones?name=example.com')
  expect(addresses.hostname('p')).toBe('demo.example.com')
  expect(await addresses.address('p')).toEqual({
    hostname: 'demo.example.com',
    port: 5555,
    tunnelToken: 'tunnel-token',
  })
  await addresses.remove('p')
  expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual([
    '/zones/zone/dns_records/rec',
    '/accounts/acc/cfd_tunnel/tun',
  ])
  expect(addresses.hostname('p')).toBeNull()
})

it('refuses wildcards and addresses as hostnames', async () => {
  const { addresses } = setup([5555])
  for (const hostname of ['*.example.com', '10.0.0.1:80', 'localhost', 'unix:/tmp/x'])
    await expect(addresses.set('p', { hostname, token: 'cf-token-cf-token-cf-token' })).rejects.toThrow('one hostname')
})
