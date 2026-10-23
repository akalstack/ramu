import { test } from 'node:test'
import assert from 'node:assert/strict'
import { otherBusyMode, resolveBusyMode } from '../src/runtime/busyMode.ts'

test('this phone’s choice wins, then the computer’s setting, then Steer', () => {
  assert.deepEqual(resolveBusyMode('queue', 'steer'), { mode: 'queue', source: 'device' })
  assert.deepEqual(resolveBusyMode('steer', 'queue'), { mode: 'steer', source: 'device' })
  assert.deepEqual(resolveBusyMode(undefined, 'queue'), { mode: 'queue', source: 'all' })
  assert.deepEqual(resolveBusyMode('', 'steer'), { mode: 'steer', source: 'all' })
  assert.deepEqual(resolveBusyMode(undefined, undefined), { mode: 'steer', source: 'default' })
})

test('an unreadable stored or host value is ignored, not trusted', () => {
  assert.deepEqual(resolveBusyMode('interrupt', 'queue'), { mode: 'queue', source: 'all' })
  assert.deepEqual(resolveBusyMode('{"mode":"queue"}', 42), { mode: 'steer', source: 'default' })
})

test('the other action is the one offered beside Send', () => {
  assert.equal(otherBusyMode('steer'), 'queue')
  assert.equal(otherBusyMode('queue'), 'steer')
})
