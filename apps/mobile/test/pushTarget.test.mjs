import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pushTarget } from '../src/runtime/pushTarget.ts'

const hosts = ['host-a', 'host-b']

test('a push about one thread opens that thread', () => {
  assert.deepEqual(pushTarget({ computerId: 'host-a', taskId: 't1', sessionId: 's', kind: 'done' }, hosts), {
    kind: 'thread',
    computerId: 'host-a',
    taskId: 't1',
  })
})

test('a scheduled run that could not start opens the schedules, with no thread to find', () => {
  assert.deepEqual(pushTarget({ computerId: 'host-b', kind: 'scheduled', target: 'schedules' }, hosts), {
    kind: 'schedules',
    computerId: 'host-b',
  })
})

test('the daily recap opens the recaps', () => {
  assert.deepEqual(pushTarget({ computerId: 'host-a', kind: 'digest', target: 'recaps' }, hosts), {
    kind: 'recaps',
    computerId: 'host-a',
  })
})

test('a push from a host this phone does not know, or with data it cannot read, opens nothing', () => {
  assert.equal(pushTarget({ computerId: 'elsewhere', target: 'schedules' }, hosts), null)
  assert.equal(pushTarget({ computerId: 'host-a' }, hosts), null)
  assert.equal(pushTarget({ computerId: 'host-a', target: 'settings' }, hosts), null)
  assert.equal(pushTarget({ taskId: 't1' }, hosts), null)
  assert.equal(pushTarget(null, hosts), null)
  assert.equal(pushTarget('x', hosts), null)
})
