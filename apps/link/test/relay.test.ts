import { beforeEach, expect, it } from 'vitest'
import { LINK_LIMITS, type LinkPool, type LinkReply } from '@ramu/shared/ramuLink'
import { createRelay } from '../src/relay'
import { TUNNEL_PREFIX, type Store } from '../src/pool'
import { fakeCloudflare, memoryStore, type FakeCloudflare } from './fakes'

const DAY = 24 * 60 * 60_000
let now = Date.UTC(2026, 10, 22, 12)
let store: Store
let cf: FakeCloudflare
let accountCalls = 0
let slugs = 0
const users: Record<string, string> = { 'token-alice': 'alice', 'token-bob': 'bob', 'token-carol': 'carol' }

const relayWith = (capacity: number) =>
  createRelay({
    store,
    cf,
    capacity,
    zone: 'akalstack.com',
    account: async (token) => {
      accountCalls++
      return users[token] ?? null
    },
    now: () => now,
    slug: () => `slug${++slugs}`,
  })

const ask = async (relay: ReturnType<typeof createRelay>, token: string, body: unknown, path = '/v1/links') => {
  const response = await relay.handle(
    new Request(`https://ramu-link.akalstack.com${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  return { status: response.status, body: (await response.json()) as LinkReply }
}
const send = (relay: ReturnType<typeof createRelay>, token: string, method: string, path: string) =>
  relay.handle(
    new Request(`https://ramu-link.akalstack.com${path}`, { method, headers: { Authorization: `Bearer ${token}` } }),
  )
const host = (hostId: string, port = 7788) => ({ hostId, name: `${hostId}-name`, port, https: false })

beforeEach(() => {
  now = Date.UTC(2026, 10, 22, 12)
  store = memoryStore()
  cf = fakeCloudflare()
  accountCalls = 0
  slugs = 0
})

it('gives a signed-in host a tunnel to its loopback port only, a CNAME and the token, idempotently', async () => {
  const relay = relayWith(2)
  const first = await ask(relay, 'token-alice', host('mac'))
  expect(first.status).toBe(200)
  expect(first.body).toMatchObject({
    state: 'active',
    hostname: 'ramu-slug1.akalstack.com',
    token: 'token-for-tunnel-1',
  })
  const tunnel = cf.tunnels.get('tunnel-1')!
  expect(tunnel.name).toBe(`${TUNNEL_PREFIX}slug1`)
  expect(tunnel.ingress).toEqual([
    { hostname: 'ramu-slug1.akalstack.com', service: 'http://localhost:7788' },
    { service: 'http_status:404' },
  ])
  expect([...cf.records.values()]).toEqual([{ name: 'ramu-slug1.akalstack.com', target: 'tunnel-1.cfargotunnel.com' }])
  const again = await ask(relay, 'token-alice', host('mac'))
  expect(again.body).toMatchObject({ state: 'active', hostname: 'ramu-slug1.akalstack.com' })
  expect(cf.calls.filter((call) => call.startsWith('create'))).toHaveLength(1)
  // Each request for a tunnel asks the account service, so a signed-out session never gets a new token.
  expect(accountCalls).toBe(2)
})

it('stops a signed-out session at once, and serves housekeeping from the cache meanwhile', async () => {
  const relay = relayWith(2)
  expect((await ask(relay, 'token-alice', host('mac'))).status).toBe(200)
  now += 2 * 60 * 60_000
  accountCalls = 0
  expect((await send(relay, 'token-alice', 'POST', '/v1/links/mac/seen')).status).toBe(204)
  expect((await send(relay, 'token-alice', 'POST', '/v1/links/mac/seen')).status).toBe(204)
  expect(accountCalls).toBe(1)
  delete users['token-alice']
  try {
    expect((await ask(relay, 'token-alice', host('mac'))).status).toBe(401)
    // The refusal also drops the cached session, so housekeeping stops too.
    expect((await send(relay, 'token-alice', 'POST', '/v1/links/mac/seen')).status).toBe(401)
  } finally {
    users['token-alice'] = 'alice'
  }
})

it('refuses a missing session, a bad body and a second host on the same account', async () => {
  const relay = relayWith(2)
  expect((await ask(relay, 'token-nobody', host('mac'))).status).toBe(401)
  expect((await ask(relay, 'token-alice', { hostId: 'mac', name: 'x', port: 99999, https: false })).status).toBe(400)
  expect((await ask(relay, 'token-alice', { ...host('../etc') })).status).toBe(400)
  await ask(relay, 'token-alice', host('mac'))
  const other = await ask(relay, 'token-alice', host('linux'))
  expect(other).toEqual({ status: 409, body: { state: 'taken', hostName: 'mac-name' } })
})

it('waitlists when full and admits in order as slots free', async () => {
  const relay = relayWith(1)
  await ask(relay, 'token-alice', host('a'))
  expect((await ask(relay, 'token-bob', host('b'))).body).toEqual({ state: 'waitlisted', position: 1, capacity: 1 })
  expect((await ask(relay, 'token-carol', host('c'))).body).toEqual({ state: 'waitlisted', position: 2, capacity: 1 })
  expect((await send(relay, 'token-alice', 'DELETE', '/v1/links/a')).status).toBe(204)
  expect(cf.tunnels.size).toBe(0)
  expect(cf.records.size).toBe(0)
  // Carol cannot jump the queue; Bob, first in line, takes the slot.
  expect((await ask(relay, 'token-carol', host('c'))).body).toEqual({ state: 'waitlisted', position: 2, capacity: 1 })
  expect((await ask(relay, 'token-bob', host('b'))).body).toMatchObject({ state: 'active' })
  const pool = (await (await relay.handle(new Request('https://ramu-link.akalstack.com/v1/pool'))).json()) as LinkPool
  expect(pool).toEqual({ capacity: 1, used: 1, waiting: 1 })
})

it('deletes the tunnel on a clean shutdown and makes a new one under the same address on return', async () => {
  const relay = relayWith(1)
  await ask(relay, 'token-alice', host('mac'))
  expect((await send(relay, 'token-alice', 'DELETE', '/v1/links/mac/online')).status).toBe(204)
  expect(cf.tunnels.size).toBe(0)
  const back = await ask(relay, 'token-alice', host('mac', 7790))
  expect(back.body).toMatchObject({
    state: 'active',
    hostname: 'ramu-slug1.akalstack.com',
    token: 'token-for-tunnel-3',
  })
  expect(cf.tunnels.get('tunnel-3')!.ingress).toContainEqual({
    hostname: 'ramu-slug1.akalstack.com',
    service: 'http://localhost:7790',
  })
  expect([...cf.records.values()]).toEqual([{ name: 'ramu-slug1.akalstack.com', target: 'tunnel-3.cfargotunnel.com' }])
})

it('keeps an offline host’s address without a tunnel or DNS record, so only hosts online fill the relay', async () => {
  const relay = relayWith(1)
  await ask(relay, 'token-alice', host('mac'))
  expect((await send(relay, 'token-alice', 'DELETE', '/v1/links/mac/online')).status).toBe(204)
  expect(cf.tunnels.size).toBe(0)
  expect(cf.records.size).toBe(0)
  // Alice's address is kept, but takes no room: Bob comes online.
  expect((await ask(relay, 'token-bob', host('b'))).body).toMatchObject({ state: 'active' })
  const pool = (await (await relay.handle(new Request('https://ramu-link.akalstack.com/v1/pool'))).json()) as LinkPool
  expect(pool).toEqual({ capacity: 1, used: 1, waiting: 0 })
  // Back while the relay is full, Alice waits in line and keeps her address.
  expect((await ask(relay, 'token-alice', host('mac'))).body).toEqual({ state: 'waitlisted', position: 1, capacity: 1 })
  expect(store.slotOf('alice')).toMatchObject({ slug: 'slug1', tunnelId: null })
  expect((await send(relay, 'token-bob', 'DELETE', '/v1/links/b/online')).status).toBe(204)
  expect((await ask(relay, 'token-alice', host('mac'))).body).toMatchObject({
    state: 'active',
    hostname: 'ramu-slug1.akalstack.com',
  })
  expect(store.waiting()).toEqual([])
  expect([...cf.records.values()].map((record) => record.name)).toEqual(['ramu-slug1.akalstack.com'])
})

it('reports a relay error without losing the slot when Cloudflare fails', async () => {
  const relay = relayWith(1)
  cf.fail = true
  expect(await ask(relay, 'token-alice', host('mac'))).toEqual({
    status: 503,
    body: { state: 'unavailable', reason: 'relay-error' },
  })
  cf.fail = false
  expect((await ask(relay, 'token-alice', host('mac'))).body).toMatchObject({ state: 'active' })
})

it('sweeps tunnels down past the limit, never-connected ones and orphans, leaving others alone', async () => {
  const relay = relayWith(3)
  await ask(relay, 'token-alice', host('a'))
  await ask(relay, 'token-bob', host('b'))
  const old = now - 2 * 60 * 60_000
  cf.listed = [
    { id: 'tunnel-1', name: `${TUNNEL_PREFIX}slug1`, status: 'down', createdAt: old, connectedAt: old },
    { id: 'tunnel-3', name: `${TUNNEL_PREFIX}slug2`, status: 'inactive', createdAt: old, connectedAt: null },
    { id: 'stray', name: `${TUNNEL_PREFIX}gone`, status: 'inactive', createdAt: old, connectedAt: null },
    { id: 'mine', name: 'my-own-tunnel', status: 'down', createdAt: old, connectedAt: old },
  ]
  expect((await relay.sweep()).deleted).toBe(2)
  expect(cf.calls).toContain('delete tunnel-3')
  expect(cf.calls).toContain('delete stray')
  expect(cf.calls).not.toContain('delete mine')
  expect(store.slotOf('alice')!.tunnelId).toBe('tunnel-1')
  now += LINK_LIMITS.offlineReleaseMs
  expect((await relay.sweep()).deleted).toBe(1)
  expect(cf.calls).toContain('delete tunnel-1')
  expect(store.slotOf('alice')).toMatchObject({ tunnelId: null, slug: 'slug1' })
})

it('warns about and then releases an address no device used, unless the host reports use', async () => {
  const relay = relayWith(2)
  await ask(relay, 'token-alice', host('a'))
  await ask(relay, 'token-bob', host('b'))
  now += LINK_LIMITS.idleWarnDays * DAY
  expect((await send(relay, 'token-bob', 'POST', '/v1/links/b/seen')).status).toBe(204)
  const warned = await relay.sweep()
  expect(warned.warned).toBe(1)
  expect(store.slotOf('alice')!.warnedAt).toBe(now)
  now += (LINK_LIMITS.idleReleaseDays - LINK_LIMITS.idleWarnDays) * DAY
  const released = await relay.sweep()
  expect(released.released).toBe(1)
  expect(store.slotOf('alice')).toBeNull()
  expect(store.slotOf('bob')).not.toBeNull()
})

it('suspends a host over the month traffic until the next month, then lets it back', async () => {
  const relay = relayWith(1)
  await ask(relay, 'token-alice', host('a'))
  cf.bytes = new Map([['ramu-slug1.akalstack.com', LINK_LIMITS.monthlyBytes]])
  const summary = await relay.sweep()
  expect(summary).toMatchObject({ counted: true, suspended: 1 })
  expect(cf.tunnels.size).toBe(0)
  const refused = await ask(relay, 'token-alice', host('a'))
  expect(refused).toMatchObject({ status: 403, body: { state: 'suspended', until: Date.UTC(2026, 11, 1) } })
  now = Date.UTC(2026, 11, 1, 1)
  expect((await ask(relay, 'token-alice', host('a'))).body).toMatchObject({
    state: 'active',
    usage: { bytes: 0 },
  })
})
