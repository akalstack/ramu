import assert from 'node:assert/strict'
import test from 'node:test'
import { remainingJournal, restoreOutbox } from '../src/runtime/sendJournal.ts'

const item = (id, state) => ({ id, state, text: id })

test('a journalled message the saved profile still shows as waiting needs a delivery check', () => {
  const restored = restoreOutbox([item('a', 'waiting'), item('b', 'waiting'), item('c', 'sending')], ['a'])
  assert.deepEqual(
    restored.map((o) => o.state),
    ['uncertain', 'waiting', 'uncertain'],
  )
})

test('messages the profile already records are left alone', () => {
  const restored = restoreOutbox([item('a', 'accepted'), item('b', 'review')], ['a', 'b'])
  assert.deepEqual(
    restored.map((o) => o.state),
    ['accepted', 'review'],
  )
})

test('the journal keeps only messages the saved profile still shows as waiting', () => {
  const left = remainingJournal(
    ['a', 'b', 'c', 'gone'],
    [item('a', 'waiting'), item('b', 'sending'), item('c', 'accepted')],
  )
  assert.deepEqual(left, ['a'])
})
