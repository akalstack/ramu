import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  otherBusyMode,
  readBusyMode,
  readModelWarning,
  resolveBusyMode,
  resolveLayered,
  resolveModelChangeWarning,
} from '../src/runtime/busyMode.ts'

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

test('the narrowest scope with its own value wins, and clearing it falls back a scope at a time', () => {
  assert.deepEqual(resolveLayered({ device: 'queue', mobile: 'steer', all: 'steer' }, 'steer'), {
    value: 'queue',
    source: 'device',
  })
  assert.deepEqual(resolveLayered({ mobile: 'queue', all: 'steer' }, 'steer'), { value: 'queue', source: 'mobile' })
  assert.deepEqual(resolveLayered({ all: 'queue' }, 'steer'), { value: 'queue', source: 'all' })
  assert.deepEqual(resolveLayered({}, 'steer'), { value: 'steer', source: 'default' })
})

test('Settings reads every scope the same way the composer does', () => {
  assert.equal(readBusyMode('queue'), 'queue')
  assert.equal(readBusyMode(''), undefined)
  assert.equal(readBusyMode('interrupt'), undefined)
  assert.equal(readModelWarning('off'), 'off')
  assert.equal(readModelWarning(false), 'off')
  assert.equal(readModelWarning(true), 'on')
  assert.equal(readModelWarning(''), undefined)
  assert.equal(readModelWarning('never'), undefined)
})
