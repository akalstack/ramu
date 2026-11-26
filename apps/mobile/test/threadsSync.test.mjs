import { test } from 'node:test'
import assert from 'node:assert/strict'
import { threadsSync } from '../src/runtime/threadsSync.ts'

test('a host still connecting or not yet read is loading with nothing to show, refreshing over held rows', () => {
  assert.equal(threadsSync([{ status: 'connecting' }], false), 'loading')
  assert.equal(threadsSync([{ status: 'online' }], false), 'loading')
  assert.equal(threadsSync([{ status: 'online' }], true), 'refreshing')
  assert.equal(threadsSync([{ status: 'connecting', read: 'read' }], true), 'refreshing')
})

test('the empty list is ready only once the read has finished', () => {
  assert.equal(threadsSync([{ status: 'online', read: 'read' }], false), 'ready')
  assert.equal(threadsSync([{ status: 'online', read: 'read' }], true), 'ready')
  assert.equal(threadsSync([], false), 'ready')
})

test('an unreachable host or a failed read says offline instead of loading forever', () => {
  assert.equal(threadsSync([{ status: 'offline' }], false), 'offline')
  assert.equal(threadsSync([{ status: 'online', read: 'failed' }], false), 'offline')
  // Held rows stay as they are; the host's own notice says it is offline.
  assert.equal(threadsSync([{ status: 'offline' }], true), 'ready')
  assert.equal(threadsSync([{ status: 'online', read: 'failed' }], true), 'ready')
})

test('several hosts: one still loading keeps the list loading, one read with no threads is a real empty list', () => {
  assert.equal(threadsSync([{ status: 'offline' }, { status: 'connecting' }], false), 'loading')
  assert.equal(threadsSync([{ status: 'offline' }, { status: 'online', read: 'read' }], false), 'ready')
  assert.equal(threadsSync([{ status: 'offline' }, { status: 'online', read: 'read' }], true), 'ready')
})

test('a revoked pairing and a host switched off are not waited for', () => {
  assert.equal(threadsSync([{ status: 'paused' }], false), 'ready')
  assert.equal(threadsSync([{ status: 'revoked' }, { status: 'online', read: 'read' }], false), 'ready')
})
