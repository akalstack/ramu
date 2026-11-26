import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync, verify } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { apnsAuthorization, MobileLiveActivities, type LiveActivitySender } from '../src/remote/mobileLiveActivity'

const directories: string[] = [],
  services: MobileLiveActivities[] = []
afterEach(() => {
  services.forEach((s) => s.dispose())
  services.length = 0
  directories.forEach((p) => rmSync(p, { recursive: true, force: true }))
  directories.length = 0
  vi.useRealTimers()
})
function fixture(enabled: boolean | (() => boolean) = true) {
  const directory = mkdtempSync(join(tmpdir(), 'ramu-activity-'))
  directories.push(directory)
  const path = join(directory, 'activities.json')
  const devices = [{ id: 'phone-a' }, { id: 'phone-b' }]
  const counts = { running: 2, needsInput: 0 }
  const sender = vi.fn<LiveActivitySender>(async () => ({ status: 200 }))
  const service = new MobileLiveActivities(
    path,
    () => devices,
    () => counts,
    sender,
    () => (typeof enabled === 'function' ? enabled() : enabled),
  )
  services.push(service)
  const registration = {
    activityId: 'activity-a',
    token: 'a'.repeat(64),
    computerId: 'computer-a',
    startedAt: Date.now(),
    locale: 'en' as const,
    environment: 'sandbox' as const,
  }
  return { path, devices, counts, sender, service, registration }
}
it('signs an Apple ES256 JWT with a raw 64-byte signature and correct claims', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ramu-apns-'))
  directories.push(directory)
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const keyPath = join(directory, 'key.p8')
  writeFileSync(keyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }))
  const jwt = apnsAuthorization(
    { keyPath, keyId: 'ABCDEFGHIJ', teamId: '0123456789', bundleId: 'com.akalstack.ramu' },
    1_000_000,
  )
  const [header, claims, signature] = jwt.split('.') as [string, string, string]
  expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'ABCDEFGHIJ' })
  expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({ iss: '0123456789', iat: 1000 })
  expect(Buffer.from(signature, 'base64url')).toHaveLength(64)
  expect(
    verify(
      'sha256',
      Buffer.from(`${header}.${claims}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    ),
  ).toBe(true)
})
it('requires a paired owner, normalizes tokens and discards extra registration fields', async () => {
  const f = fixture()
  await expect(f.service.register('unknown', f.registration)).rejects.toThrow('paired')
  await expect(
    f.service.register('phone-a', { ...f.registration, activityId: undefined } as unknown as typeof f.registration),
  ).rejects.toThrow('Invalid')
  await f.service.register('phone-a', {
    ...f.registration,
    token: f.registration.token.toUpperCase(),
    secret: 'private transcript',
  } as typeof f.registration)
  expect(readFileSync(f.path, 'utf8')).not.toContain('secret')
  await expect(f.service.register('phone-b', { ...f.registration, activityId: 'activity-b' })).rejects.toThrow(
    'another paired',
  )
  f.service.remove('phone-b', f.registration.activityId)
  expect(JSON.parse(readFileSync(f.path, 'utf8'))).toHaveLength(1)
})
it('sends only status, deduplicates unchanged work and ends completed activity', async () => {
  const f = fixture()
  await f.service.register('phone-a', f.registration)
  await f.service.flush()
  await f.service.flush()
  expect(f.sender).toHaveBeenCalledTimes(1)
  let push = f.sender.mock.calls[0]![0]
  expect(push.event).toBe('update')
  expect(push.staleDate).toBeGreaterThan(Date.now() / 1000)
  expect(JSON.parse(push.props)).toEqual({
    running: 2,
    waiting: 0,
    startedAt: f.registration.startedAt,
    updatedAt: expect.any(Number),
    locale: 'en',
    phase: 'working',
    tone: 'working',
  })
  expect(Buffer.byteLength(JSON.stringify(push))).toBeLessThan(4096)
  expect(JSON.stringify(push)).not.toContain('computer-a')
  f.counts.needsInput = 1
  await f.service.flush()
  expect(JSON.parse(f.sender.mock.calls[1]![0].props)).toMatchObject({
    phase: 'waiting',
    tone: 'attention',
    need: 'input',
  })
  f.counts.running = 0
  f.counts.needsInput = 0
  await f.service.flush()
  push = f.sender.mock.calls[2]![0]
  expect(push.event).toBe('end')
  // The finished activity leaves the Lock Screen after a few minutes, not hours later, and carries no counts.
  expect(push.dismissalDate).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000) + 239)
  expect(push.dismissalDate).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 241)
  expect(JSON.parse(push.props)).toMatchObject({ running: 0, waiting: 0, phase: 'finished', tone: 'done' })
  expect(JSON.parse(push.props).rows).toBeUndefined()
  await f.service.flush()
  expect(f.sender).toHaveBeenCalledTimes(3)
})
it('immediately dismisses revoked or expired activities', async () => {
  vi.useFakeTimers()
  const f = fixture()
  await f.service.register('phone-a', f.registration)
  f.devices.splice(0, 1)
  await f.service.flush()
  expect(f.sender.mock.calls[0]![0].dismissalDate).toBe(0)
  await f.service.register('phone-b', { ...f.registration, activityId: 'activity-b' })
  vi.setSystemTime(Date.now() + 8 * 60 * 60_000)
  await f.service.flush()
  expect(f.sender.mock.calls[1]![0].event).toBe('end')
  expect(f.sender.mock.calls[1]![0].dismissalDate).toBe(0)
})
it('retries failed completion deliveries and drops invalidated APNs tokens', async () => {
  const f = fixture()
  await f.service.register('phone-a', f.registration)
  f.counts.running = 0
  f.sender.mockResolvedValueOnce({ status: 503 })
  await f.service.flush()
  expect(JSON.parse(readFileSync(f.path, 'utf8'))).toHaveLength(1)
  await f.service.flush()
  expect(JSON.parse(readFileSync(f.path, 'utf8'))).toHaveLength(0)
  f.counts.running = 1
  await f.service.register('phone-a', f.registration)
  f.sender.mockResolvedValueOnce({ status: 410 })
  await f.service.flush()
  expect(JSON.parse(readFileSync(f.path, 'utf8'))).toHaveLength(0)
})
it('leaves background registration disabled without host credentials', async () => {
  const f = fixture(false)
  expect(await f.service.register('phone-a', f.registration)).toEqual({ enabled: false })
  await f.service.flush()
  expect(f.sender).not.toHaveBeenCalled()
})

it('starts the activity on a phone with Ramu closed once work has gone on a little, once per stretch of work', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const start = {
    token: 'b'.repeat(64),
    computerId: 'computer-a',
    locale: 'id' as const,
    environment: 'sandbox' as const,
  }
  f.service.registerStart('phone-a', start)
  expect(() => f.service.registerStart('unknown', start)).toThrow('paired')
  expect(() => f.service.registerStart('phone-a', { ...start, computerId: 'a&b' })).toThrow('Invalid')
  // Work just began: a phone with Ramu open would start its own, so nothing is sent yet.
  await f.service.flush()
  expect(f.sender).not.toHaveBeenCalled()
  vi.setSystemTime(Date.now() + 16_000)
  await f.service.flush()
  expect(f.sender).toHaveBeenCalledTimes(1)
  const push = f.sender.mock.calls[0]![0]
  expect(push).toMatchObject({ event: 'start', token: start.token, computerId: 'computer-a' })
  expect(push.alert).toEqual({ title: 'Ramu', body: '2 agen sedang bekerja' })
  expect(JSON.parse(push.props)).toMatchObject({ running: 2, phase: 'working', locale: 'id' })
  // The same stretch of work never starts it twice.
  await f.service.flush()
  expect(f.sender).toHaveBeenCalledTimes(1)
  // Work ended and began again: a new stretch, started again.
  f.counts.running = 0
  await f.service.flush()
  f.counts.running = 1
  await f.service.flush()
  vi.setSystemTime(Date.now() + 16_000)
  await f.service.flush()
  expect(f.sender.mock.calls.filter(([p]) => p.event === 'start')).toHaveLength(2)
})

it('does not start one on a phone that already shows its own, or that took its token back', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const start = {
    token: 'b'.repeat(64),
    computerId: 'computer-a',
    locale: 'en' as const,
    environment: 'sandbox' as const,
  }
  f.service.registerStart('phone-a', start)
  f.service.registerStart('phone-b', { ...start, token: 'c'.repeat(64) })
  await f.service.register('phone-a', f.registration)
  f.service.removeStart('phone-b')
  vi.setSystemTime(Date.now() + 16_000)
  await f.service.flush()
  expect(f.sender.mock.calls.map(([p]) => p.event)).toEqual(['update'])
})

it('stops using a route that cannot send, so the phone keeps its own updates meanwhile', async () => {
  vi.useFakeTimers()
  const f = fixture()
  await f.service.register('phone-a', f.registration)
  f.sender.mockResolvedValueOnce({ status: 503, reason: 'LinkUnavailable' })
  await f.service.flush()
  expect(await f.service.available()).toBe(false)
  expect(await f.service.register('phone-a', f.registration)).toEqual({ enabled: false })
  vi.setSystemTime(Date.now() + 11 * 60_000)
  expect(await f.service.available()).toBe(true)
})

it('sends through Ramu Link with the host account, and reports a signed-out host as refused', async () => {
  const { createLinkLiveActivitySender } = await import('../src/remote/mobileLiveActivity')
  const fetcher = vi.fn(async () => Response.json({ status: 410, reason: 'Unregistered' }))
  const push = { token: 'a'.repeat(64), environment: 'production' as const, event: 'update' as const, props: '{}' }
  expect(await createLinkLiveActivitySender(async () => null, fetcher as never)(push)).toEqual({ status: 401 })
  expect(fetcher).not.toHaveBeenCalled()
  expect(await createLinkLiveActivitySender(async () => 'session', fetcher as never)(push)).toEqual({
    status: 410,
    reason: 'Unregistered',
  })
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('https://ramu-link.akalstack.com/v1/live-activities')
  expect(init.headers).toMatchObject({ Authorization: 'Bearer session' })
  expect(JSON.parse(String(init.body))).toEqual(push)
})

it('does not start the activity again in the same work after the person swiped it away', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const start = {
    token: 'b'.repeat(64),
    computerId: 'computer-a',
    locale: 'en' as const,
    environment: 'sandbox' as const,
  }
  f.service.registerStart('phone-a', start)
  await f.service.register('phone-a', f.registration)
  await f.service.flush()
  // Swiped away: its token is gone.
  f.counts.running = 3
  f.sender.mockResolvedValueOnce({ status: 410 })
  await f.service.flush()
  vi.setSystemTime(Date.now() + 16_000)
  await f.service.flush()
  expect(f.sender.mock.calls.map(([p]) => p.event)).toEqual(['update', 'update'])
})
