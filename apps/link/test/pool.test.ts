import { expect, it } from 'vitest'
import { admission, ingressFor, newSlot, nextMonth, promoteWaiting, PROMOTION_EXPIRES_MS } from '../src/pool'
import { bearerOf, linkRequest } from '../src/validate'
import { memoryStore } from './fakes'

it('lets a newcomer in only when free room outnumbers everyone waiting, counting only hosts online', () => {
  const store = memoryStore()
  store.putSlot({ ...newSlot('a', 'host-a', 'A', 's1', 0), tunnelId: 'tunnel-a' })
  // An address whose host is offline takes no room.
  store.putSlot(newSlot('off', 'host-off', 'Off', 's2', 0))
  store.putWaiting({ userId: 'w', hostId: 'host-w', hostName: 'W', since: 1, promotedAt: null })
  expect(admission(store, 'new', 'host-new', 2, 0)).toEqual({ kind: 'wait', position: 2 })
  expect(admission(store, 'w', 'host-w', 2, 0)).toEqual({ kind: 'admit' })
  expect(admission(store, 'new', 'host-new', 3, 0)).toEqual({ kind: 'admit' })
  expect(admission(store, 'a', 'host-a', 1, 0).kind).toBe('slot')
})

it('lets a host back online under its address while there is room, and in line behind others when there is not', () => {
  const store = memoryStore()
  store.putSlot({ ...newSlot('a', 'host-a', 'A', 's1', 0), tunnelId: 'tunnel-a' })
  const off = newSlot('off', 'host-off', 'Off', 's2', 0)
  store.putSlot(off)
  expect(admission(store, 'off', 'host-off', 2, 0)).toEqual({ kind: 'slot', slot: off })
  expect(admission(store, 'off', 'host-off', 1, 0)).toEqual({ kind: 'wait', position: 1 })
  store.putWaiting({ userId: 'w', hostId: 'host-w', hostName: 'W', since: 1, promotedAt: null })
  expect(admission(store, 'off', 'host-off', 2, 0)).toEqual({ kind: 'wait', position: 2 })
  expect(admission(store, 'off', 'host-other', 2, 0)).toEqual({ kind: 'taken', hostName: 'Off' })
  // Paused for its traffic, it gets its slot back to hear why, with no tunnel.
  const paused = { ...off, suspendedUntil: 10 }
  store.putSlot(paused)
  expect(admission(store, 'off', 'host-off', 1, 5)).toEqual({ kind: 'slot', slot: paused })
})

it('marks waiting hosts free slots admit and drops those that never came back', () => {
  const store = memoryStore()
  store.putWaiting({ userId: 'gone', hostId: 'g', hostName: 'G', since: 1, promotedAt: 0 })
  store.putWaiting({ userId: 'next', hostId: 'n', hostName: 'N', since: 2, promotedAt: null })
  store.putWaiting({ userId: 'later', hostId: 'l', hostName: 'L', since: 3, promotedAt: null })
  expect(promoteWaiting(store, 1, PROMOTION_EXPIRES_MS)).toEqual({ promoted: 1, dropped: 1 })
  expect(store.waiting().map((entry) => [entry.userId, entry.promotedAt])).toEqual([
    ['next', PROMOTION_EXPIRES_MS],
    ['later', null],
  ])
})

it('builds a loopback-only ingress, skipping certificate checks for the host’s own HTTPS', () => {
  expect(ingressFor('ramu-x.akalstack.com', 8443, true)[0]).toEqual({
    hostname: 'ramu-x.akalstack.com',
    service: 'https://localhost:8443',
    originRequest: { noTLSVerify: true },
  })
})

it('bounds what a host may send', () => {
  expect(linkRequest.safeParse({ hostId: 'a'.repeat(101), name: 'x', port: 1, https: false }).success).toBe(false)
  expect(linkRequest.safeParse({ hostId: 'ok', name: ' ', port: 1, https: false }).success).toBe(false)
  expect(bearerOf('Bearer short')).toBeNull()
  expect(bearerOf(`Bearer ${'x'.repeat(600)}`)).toBeNull()
  expect(bearerOf('Bearer abcdefgh.ijk')).toBe('abcdefgh.ijk')
  expect(nextMonth(Date.UTC(2026, 11, 31, 23))).toBe(Date.UTC(2027, 0, 1))
})
