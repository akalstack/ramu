import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  attemptStatus,
  connectionGate,
  connectionPending,
  failureStatus,
  mayConnect,
  restoredStatus,
} from '../src/runtime/hostConnection.ts'

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

test('only a host shown online or connecting is worth waiting for', () => {
  assert.equal(connectionPending('online'), true)
  assert.equal(connectionPending('connecting'), true)
  for (const status of ['offline', 'paused', 'revoked', undefined]) assert.equal(connectionPending(status), false)
})

test('a call made while the connection re-opens runs once it is there', async () => {
  const gate = connectionGate(1000)
  let connection
  const waiting = gate.wait(
    'host',
    () => connection,
    () => true,
  )
  connection = 'open'
  gate.settle('host')
  assert.equal(await waiting, 'open')
})

test('a call is refused at once when no attempt is under way, and as soon as the attempt fails', async () => {
  const gate = connectionGate(1000)
  assert.equal(
    await gate.wait(
      'host',
      () => undefined,
      () => false,
    ),
    undefined,
  )
  let pending = true
  const waiting = gate.wait(
    'host',
    () => undefined,
    () => pending,
  )
  pending = false
  gate.settle('host')
  assert.equal(await waiting, undefined)
})

test('a connection that never opens stops holding the call after the wait, and another host does not release it', async () => {
  const gate = connectionGate(20)
  const started = Date.now()
  const waiting = gate.wait(
    'host',
    () => undefined,
    () => true,
  )
  gate.settle('other')
  assert.equal(await waiting, undefined)
  assert.ok(Date.now() - started >= 15)
})
