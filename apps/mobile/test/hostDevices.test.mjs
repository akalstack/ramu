import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deviceRows, devicesAccess, othersCount } from '../src/runtime/hostDevices.ts'

const view = (settings) => ({
  permissions: { computer: null, browser: null, terminal: null, settings, agents: null },
  pending: [],
  blocked: [],
})

test('a full-access phone manages devices with the settings permission, and asks for it otherwise', () => {
  const now = Date.now()
  assert.equal(devicesAccess('owner', view({ until: null }), now), 'manage')
  assert.equal(devicesAccess(undefined, view({ until: now + 60_000 }), now), 'manage')
  assert.equal(devicesAccess('owner', view(null), now), 'request')
  assert.equal(devicesAccess('owner', view({ until: now - 1 }), now), 'request')
  // Not read yet: the screen offers it, and the host's own answer explains a refusal.
  assert.equal(devicesAccess('owner', undefined, now), 'manage')
  assert.equal(devicesAccess('viewer', view({ until: null }), now), 'viewer')
})

test('lists this phone first, then the most recently seen, without linked hosts', () => {
  const devices = [
    { id: 'a', name: 'Old laptop', createdAt: 1, lastSeenAt: 10 },
    { id: 'b', name: 'Build box', createdAt: 1, lastSeenAt: 99, kind: 'host' },
    { id: 'c', name: 'iPad', createdAt: 1, lastSeenAt: 50 },
    { id: 'me', name: 'Ahmad’s iPhone', createdAt: 1, lastSeenAt: 5 },
    { id: 'd', name: 'Never used', createdAt: 1, lastSeenAt: null },
  ]
  const rows = deviceRows({ devices, self: 'me' })
  assert.deepEqual(
    rows.map((row) => [row.device.id, row.self]),
    [
      ['me', true],
      ['c', false],
      ['a', false],
      ['d', false],
    ],
  )
  assert.equal(othersCount(rows), 3)
  assert.equal(othersCount(deviceRows({ devices: [devices[3]], self: 'me' })), 0)
})
