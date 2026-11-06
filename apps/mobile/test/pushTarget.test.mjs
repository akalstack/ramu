import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pushTarget, readPushes } from '../src/runtime/pushTarget.ts'

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

test('a delivered push leaves once its notice is read elsewhere, but not before the host listed it', () => {
  const push = (id, sessionId, computerId = 'host-a') => ({ id, data: { computerId, taskId: 't', sessionId } })
  const presented = [push('p1', 's1'), push('p2', 's2'), push('p3', 's3', 'host-b'), { id: 'p4', data: null }]
  const listed = new Map([['host-a', new Set(['agent:s1'])]])
  assert.deepEqual(readPushes(presented, listed, { 'host-a': [] }), ['p1'])
  assert.deepEqual(readPushes(presented, listed, { 'host-a': [{ id: 'agent:s1' }] }), [])
  // A host whose inbox has not loaded decides nothing.
  assert.deepEqual(readPushes(presented, listed, {}), [])
})

test("an artifact's notification opens that artifact, also when a host a release behind calls it a page", () => {
  for (const target of ['artifact', 'page'])
    assert.deepEqual(pushTarget({ computerId: 'host-a', kind: 'pages', target, pageId: 'p-1' }, hosts), {
      kind: 'artifact',
      computerId: 'host-a',
      pageId: 'p-1',
    })
  assert.equal(pushTarget({ computerId: 'host-a', target: 'artifact', pageId: '../x' }, hosts), null)
  assert.equal(pushTarget({ computerId: 'host-a', target: 'page', pageId: '../x' }, hosts), null)
})
