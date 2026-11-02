import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mayConnect, restoredStatus } from '../src/runtime/hostConnection.ts'

test('a host switched off stays off after the app restarts, and is never retried', () => {
  assert.equal(restoredStatus('paused'), 'paused')
  assert.equal(mayConnect('paused'), false)
})

test('a revoked pairing stays revoked; every other host reconnects on start', () => {
  assert.equal(restoredStatus('revoked'), 'revoked')
  for (const status of ['online', 'offline', 'connecting']) {
    assert.equal(restoredStatus(status), 'connecting')
    assert.equal(mayConnect(status), true)
  }
})
