import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attemptStatus, failureStatus, mayConnect, restoredStatus } from '../src/runtime/hostConnection.ts'

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

test('background retries of an offline host keep it offline instead of flickering to Connecting', () => {
  assert.equal(attemptStatus('offline', true), null)
  assert.equal(attemptStatus('offline', false), 'connecting')
  assert.equal(attemptStatus('connecting', true), 'connecting')
  assert.equal(attemptStatus('online', false), 'connecting')
})

test('a dropped live link shows Connecting for its quick retry; a failed attempt shows Offline', () => {
  assert.equal(failureStatus(true), 'connecting')
  assert.equal(failureStatus(false), 'offline')
})
