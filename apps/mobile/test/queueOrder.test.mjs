import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moveQueued } from '../src/runtime/queueOrder.ts'

test('moves a queued message past its shown neighbour and leaves hidden steers in place', () => {
  const order = ['a', 'steer', 'b', 'c']
  const shown = ['a', 'b', 'c']
  assert.deepEqual(moveQueued(order, shown, 'b', -1), ['b', 'steer', 'a', 'c'])
  assert.deepEqual(moveQueued(order, shown, 'b', 1), ['a', 'steer', 'c', 'b'])
  assert.equal(moveQueued(order, shown, 'a', -1), null)
  assert.equal(moveQueued(order, shown, 'c', 1), null)
  assert.equal(moveQueued(order, shown, 'missing', 1), null)
})
