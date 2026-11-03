import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { LinkPlanStatus } from '@ramu/shared/link/protocol'
import type { HostCredentialStore } from '../src/credentials/store'
import { LinkService } from '../src/remote/link/service'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const PLAN: LinkPlanStatus = {
  plan: 'free',
  source: 'free',
  expiresAt: null,
  renews: false,
  hosts: 2,
  hostLimit: 3,
  month: '2026-11',
  relayedSeconds: 3600,
  relayedLimitSeconds: 216000,
  checkout: true,
}

/** A signed-in host whose session lives in a fake credential store, talking to a fake Ramu Link service. */
function signedIn(answer: (url: string, init: RequestInit) => unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-link-plan-'))
  dirs.push(dir)
  const statePath = join(dir, 'link.json')
  writeFileSync(
    statePath,
    JSON.stringify({
      service: 'https://link.example.com',
      enabled: false,
      account: { name: 'Ada', email: 'ada@example.com' },
      refs: { session: 'ref' },
    }),
  )
  const calls: { url: string; init: RequestInit }[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const value = answer(url, init)
    return value instanceof Response ? value : new Response(JSON.stringify(value), { status: 200 })
  }) as unknown as typeof fetch
  const credentials = { read: async () => 'session-token', remove: async () => {} } as unknown as HostCredentialStore
  const service = new LinkService({
    statePath,
    hostId: 'a'.repeat(32),
    hostName: () => 'Studio',
    server: createServer(),
    changed: () => {},
    credentials,
    fetcher,
  })
  return { service, calls }
}

it('shows the plan and this month’s relayed time once the service answers', async () => {
  const { service, calls } = signedIn(() => ({ user: { name: 'Ada', email: 'ada@example.com' }, plan: PLAN }))
  expect(service.status().plan).toBeNull()
  expect((await service.refreshPlan()).plan).toEqual(PLAN)
  expect(calls[0]!.url).toBe('https://link.example.com/v1/me')
  expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer session-token')
})

it('opens a checkout for the chosen interval and manages who the host is shared with', async () => {
  const shares = [{ userId: 'u2', name: 'Bo', email: 'bo@example.com', createdAt: 1 }]
  const { service, calls } = signedIn((url) => (url.endsWith('/v1/checkout') ? { url: 'https://pay/x' } : { shares }))
  expect(await service.checkout('year')).toEqual({ url: 'https://pay/x' })
  expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ interval: 'year' })
  expect(await service.share('bo@example.com')).toEqual(shares)
  expect(calls.at(-2)!.init.method).toBe('POST')
  await service.unshare('u2')
  expect(calls.at(-2)!.url).toBe(`https://link.example.com/v1/hosts/${'a'.repeat(32)}/shares/u2`)
  expect(calls.at(-2)!.init.method).toBe('DELETE')
})

it('deletes the account on the service before forgetting it here, and keeps everything when the service refuses', async () => {
  let refuse = true
  const { service, calls } = signedIn(() =>
    refuse
      ? new Response(JSON.stringify({ error: 'Your Plus subscription could not be cancelled' }), { status: 502 })
      : { deleted: true },
  )
  await expect(service.deleteAccount()).rejects.toThrow('could not be cancelled')
  expect(service.status().account).not.toBeNull()
  refuse = false
  await service.deleteAccount()
  expect(calls.map((call) => [call.init.method, call.url])).toEqual([
    ['DELETE', 'https://link.example.com/v1/me'],
    ['DELETE', 'https://link.example.com/v1/me'],
  ])
  expect(service.status().account).toBeNull()
})
