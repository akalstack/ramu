import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rebuildDelay, readsTranscript } from '../src/runtime/refreshDepth.ts'

const idle = { taskId: 't', state: 'idle', knownState: 'idle', awaitingDelivery: false }

test('booleans and task sets decide outright', () => {
  assert.equal(readsTranscript(true, idle), true)
  assert.equal(readsTranscript(false, { ...idle, state: 'running' }), false)
  assert.equal(readsTranscript(new Set(['t']), idle), true)
  assert.equal(readsTranscript(new Set(['other']), { ...idle, state: 'running' }), false)
})

test('the periodic refresh reads only threads that can have changed unseen', () => {
  assert.equal(readsTranscript('live', idle), false)
  assert.equal(readsTranscript('live', { ...idle, state: 'running', knownState: 'running' }), true)
  assert.equal(readsTranscript('live', { ...idle, state: 'stopped' }), true)
  assert.equal(readsTranscript('live', { ...idle, awaitingDelivery: true }), true)
})

test('rebuilds back off with their cost, within bounds', () => {
  assert.equal(rebuildDelay(0), 50)
  assert.equal(rebuildDelay(40), 160)
  assert.equal(rebuildDelay(1000), 500)
})
