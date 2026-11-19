import { expect, it, vi } from 'vitest'
import { PairBackInvites } from '../src/remote/pairBackInvites'
import type { DeviceInfo } from '../src/remote/devices'

const laptop: DeviceInfo = {
  id: 'laptop',
  name: 'Laptop',
  createdAt: 0,
  lastSeenAt: null,
  expiresAt: null,
  role: 'owner',
}
const invite = (expiresAt: number) => ({
  name: 'Studio',
  urls: ['http://192.168.1.20:7788', 'https://link.example.com/h/abc'],
  code: 'ABCDE-FGHJK',
  expiresAt,
})

it('keeps one invitation per computer until it is answered or its code lapses', () => {
  let now = 1000
  const changed = vi.fn()
  const invites = new PairBackInvites(() => now, changed)
  invites.invite(laptop, invite(now + 60_000))
  invites.invite(laptop, invite(now + 120_000))
  expect(invites.list()).toHaveLength(1)
  expect(invites.list()[0]).toMatchObject({ deviceId: 'laptop', name: 'Studio', expiresAt: 121_000 })
  expect(changed).toHaveBeenCalledTimes(2)
  now = 121_000
  expect(invites.list()).toEqual([])
  invites.invite(laptop, invite(now + 60_000))
  invites.dismiss(invites.list()[0]!.id)
  expect(invites.list()).toEqual([])
})

it('drops a revoked computer’s invitation', () => {
  const invites = new PairBackInvites(() => 0)
  invites.invite(laptop, invite(60_000))
  invites.forget('laptop')
  expect(invites.list()).toEqual([])
})

it('refuses viewers, paired hosts, bad addresses and long-lived codes', () => {
  const invites = new PairBackInvites(() => 0)
  expect(() => invites.invite({ ...laptop, role: 'viewer' }, invite(60_000))).toThrow(/full access/)
  expect(() => invites.invite({ ...laptop, kind: 'host' }, invite(60_000))).toThrow(/full access/)
  expect(() => invites.invite(laptop, { ...invite(60_000), urls: ['file:///etc/passwd'] })).toThrow()
  expect(() => invites.invite(laptop, { ...invite(60_000), code: 'nope' })).toThrow()
  expect(() => invites.invite(laptop, invite(60 * 60_000))).toThrow(/expired/)
  expect(() => invites.invite(laptop, invite(0))).toThrow(/expired/)
  expect(invites.list()).toEqual([])
})
