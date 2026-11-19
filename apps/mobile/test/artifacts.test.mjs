import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageCopy, queueCall, queuedCalls, savePageCopy, syncCalls } from '../src/runtime/artifacts.ts'

const memory = () => {
  const data = new Map()
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
}

test('a saved copy is kept per host and artifact', () => {
  const storage = memory()
  const document = { reference: { id: 'p', version: 2 }, html: '<p>x</p>', preview: null }
  savePageCopy(storage, 'h', 'p', document)
  assert.deepEqual(pageCopy(storage, 'h', 'p'), document)
  assert.equal(pageCopy(storage, 'other', 'p'), null)
})

test('offline calls sync in order, keep conflicts aside and stop when the host is away again', async () => {
  const storage = memory()
  for (const id of ['a', 'b', 'c']) queueCall(storage, 'h', 'p', { id, method: 'records.add', args: [id], at: 1 })
  const first = await syncCalls(
    storage,
    'h',
    'p',
    async (call) => {
      if (call.id === 'b') throw new Error('Record not saved: amount is required.')
      if (call.id === 'c') throw new Error('offline')
      return call.id
    },
    (error) => !String(error).includes('offline'),
  )
  assert.equal(first.sent, 1)
  assert.deepEqual(
    first.conflicts.map((entry) => entry.call.id),
    ['b'],
  )
  assert.deepEqual(
    queuedCalls(storage, 'h', 'p').map((call) => call.id),
    ['c'],
  )
  const second = await syncCalls(
    storage,
    'h',
    'p',
    async (call) => call.id,
    () => true,
  )
  assert.equal(second.sent, 1)
  assert.deepEqual(queuedCalls(storage, 'h', 'p'), [])
})
