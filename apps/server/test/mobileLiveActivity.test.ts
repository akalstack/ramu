import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync, verify } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { apnsAuthorization, MobileLiveActivities, type LiveActivitySender } from '../src/mobileLiveActivity'

const directories: string[] = [], services: MobileLiveActivities[] = []
afterEach(() => { services.forEach(s => s.dispose()); services.length = 0; directories.forEach(p => rmSync(p, { recursive: true, force: true })); directories.length = 0; vi.useRealTimers() })
function fixture(enabled = true) {
  const directory = mkdtempSync(join(tmpdir(), 'ramu-activity-')); directories.push(directory)
  const path = join(directory, 'activities.json')
  const devices = [{ id: 'phone-a' }, { id: 'phone-b' }]
  const counts = { running: 2, needsInput: 0 }
  const sender = vi.fn<LiveActivitySender>(async () => ({ status: 200 }))
  const service = new MobileLiveActivities(path, () => devices, () => counts, sender, () => enabled); services.push(service)
  const registration = { activityId: 'activity-a', token: 'a'.repeat(64), computerId: 'computer-a', startedAt: Date.now(), locale: 'en' as const, environment: 'sandbox' as const }
  return { path, devices, counts, sender, service, registration }
}
it('signs an Apple ES256 JWT with a raw 64-byte signature and correct claims', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ramu-apns-')); directories.push(directory)
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const keyPath = join(directory, 'key.p8'); writeFileSync(keyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }))
  const jwt = apnsAuthorization({ keyPath, keyId: 'ABCDEFGHIJ', teamId: '0123456789', bundleId: 'dev.ramu.mobile' }, 1_000_000)
  const [header, claims, signature] = jwt.split('.') as [string, string, string]
  expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'ABCDEFGHIJ' })
  expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({ iss: '0123456789', iat: 1000 })
  expect(Buffer.from(signature, 'base64url')).toHaveLength(64)
  expect(verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))).toBe(true)
})
it('requires a paired owner, normalizes tokens and discards extra registration fields', () => {
  const f = fixture()
  expect(() => f.service.register('unknown', f.registration)).toThrow('paired')
  expect(() => f.service.register('phone-a', { ...f.registration, activityId: undefined } as unknown as typeof f.registration)).toThrow('Invalid')
  f.service.register('phone-a', { ...f.registration, token: f.registration.token.toUpperCase(), secret: 'private transcript' } as typeof f.registration)
  expect(readFileSync(f.path, 'utf8')).not.toContain('secret')
  expect(() => f.service.register('phone-b', { ...f.registration, activityId: 'activity-b' })).toThrow('another paired')
  f.service.remove('phone-b', f.registration.activityId)
  expect(JSON.parse(readFileSync(f.path, 'utf8'))).toHaveLength(1)
})
it('sends only status, deduplicates unchanged work and ends completed activity', async () => {
  const f = fixture(); f.service.register('phone-a', f.registration)
  await f.service.flush(); await f.service.flush()
  expect(f.sender).toHaveBeenCalledTimes(1)
  let payload = f.sender.mock.calls[0]![1]
  expect(payload.aps.event).toBe('update'); expect(payload.aps['stale-date']).toBeGreaterThan(payload.aps.timestamp)
  expect(JSON.parse(payload.aps['content-state'].props)).toEqual({ running: 2, waiting: 0, startedAt: f.registration.startedAt, updatedAt: expect.any(Number), locale: 'en', phase: 'working' })
  expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(4096)
  expect(JSON.stringify(payload)).not.toContain('computer-a')
  f.counts.needsInput = 1; await f.service.flush()
  expect(JSON.parse(f.sender.mock.calls[1]![1].aps['content-state'].props).phase).toBe('waiting')
  f.counts.running = 0; f.counts.needsInput = 0; await f.service.flush()
  payload = f.sender.mock.calls[2]![1]; expect(payload.aps.event).toBe('end'); expect(payload.aps['dismissal-date']).toBe(payload.aps.timestamp + 900)
  await f.service.flush(); expect(f.sender).toHaveBeenCalledTimes(3)
})
it('immediately dismisses revoked or expired activities', async () => {
  vi.useFakeTimers(); const f = fixture(); f.service.register('phone-a', f.registration)
  f.devices.splice(0, 1); await f.service.flush()
  expect(f.sender.mock.calls[0]![1].aps['dismissal-date']).toBe(0)
  f.service.register('phone-b', { ...f.registration, activityId: 'activity-b' })
  vi.setSystemTime(Date.now() + 8 * 60 * 60_000); await f.service.flush()
  expect(f.sender.mock.calls[1]![1].aps.event).toBe('end')
  expect(f.sender.mock.calls[1]![1].aps['dismissal-date']).toBe(0)
})
it('retries failed completion deliveries and drops invalidated APNs tokens', async () => {
  const f = fixture(); f.service.register('phone-a', f.registration); f.counts.running = 0
  f.sender.mockResolvedValueOnce({ status: 503 }); await f.service.flush()
  expect(JSON.parse(readFileSync(f.path, 'utf8'))).toHaveLength(1)
  await f.service.flush(); expect(JSON.parse(readFileSync(f.path, 'utf8'))).toHaveLength(0)
  f.counts.running = 1; f.service.register('phone-a', f.registration)
  f.sender.mockResolvedValueOnce({ status: 410 }); await f.service.flush()
  expect(JSON.parse(readFileSync(f.path, 'utf8'))).toHaveLength(0)
})
it('leaves background registration disabled without host credentials', async () => {
  const f = fixture(false); expect(f.service.register('phone-a', f.registration)).toEqual({ enabled: false })
  await f.service.flush(); expect(f.sender).not.toHaveBeenCalled()
})
