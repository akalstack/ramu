import { test } from 'node:test'
import assert from 'node:assert/strict'
import { otherBusyMode, resolveBusyMode, resolveModelChangeWarning } from '../src/runtime/busyMode.ts'

test('this phone wins, then all your phones, then the computer, then Steer', () => {
  assert.deepEqual(resolveBusyMode('queue', 'steer', 'steer'), { mode: 'queue', source: 'device' })
  assert.deepEqual(resolveBusyMode('steer', 'queue', 'queue'), { mode: 'steer', source: 'device' })
  assert.deepEqual(resolveBusyMode(undefined, 'queue', 'steer'), { mode: 'queue', source: 'mobile' })
  assert.deepEqual(resolveBusyMode('', undefined, 'queue'), { mode: 'queue', source: 'all' })
  assert.deepEqual(resolveBusyMode(undefined, undefined, undefined), { mode: 'steer', source: 'default' })
})

test('an unreadable stored, shared or host value is ignored, not trusted', () => {
  assert.deepEqual(resolveBusyMode('interrupt', 'later', 'queue'), { mode: 'queue', source: 'all' })
  assert.deepEqual(resolveBusyMode('{"mode":"queue"}', true, 42), { mode: 'steer', source: 'default' })
})

test('the other action is the one offered beside Send', () => {
  assert.equal(otherBusyMode('steer'), 'queue')
  assert.equal(otherBusyMode('queue'), 'steer')
})

test('the model-change warning follows this phone, then all your phones, then the computer, then warns', () => {
  assert.deepEqual(resolveModelChangeWarning('off', true, true), { warn: false, source: 'device' })
  assert.deepEqual(resolveModelChangeWarning('on', false, false), { warn: true, source: 'device' })
  assert.deepEqual(resolveModelChangeWarning('', false, true), { warn: false, source: 'mobile' })
  assert.deepEqual(resolveModelChangeWarning(undefined, undefined, false), { warn: false, source: 'all' })
  assert.deepEqual(resolveModelChangeWarning(undefined, undefined, undefined), { warn: true, source: 'default' })
  assert.deepEqual(resolveModelChangeWarning('never', 'x', 'y'), { warn: true, source: 'default' })
})
