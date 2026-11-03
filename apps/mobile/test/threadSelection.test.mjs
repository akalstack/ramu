import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { donePlan, threadSelection } from '../src/runtime/threadSelection.ts'

beforeEach(() => threadSelection.clear())

test('selecting starts with the long-pressed thread and stays on with nothing picked until cancelled', () => {
  threadSelection.start('a')
  threadSelection.toggle('b')
  assert.deepEqual([...threadSelection.state().ids], ['a', 'b'])
  threadSelection.toggle('a')
  threadSelection.toggle('b')
  assert.equal(threadSelection.state().on, true)
  assert.equal(threadSelection.state().ids.size, 0)
  threadSelection.clear()
  assert.equal(threadSelection.state().on, false)
})

test('threads that leave the list leave the selection', () => {
  threadSelection.start('a')
  threadSelection.toggle('b')
  threadSelection.keep(new Set(['b', 'c']))
  assert.deepEqual([...threadSelection.state().ids], ['b'])
})

test('mark done finishes idle threads, skips busy and archived ones, and reopens when all are done', () => {
  const idle = { status: 'idle', doneAt: null }
  const running = { status: 'running', doneAt: null }
  const archived = { status: 'archived', doneAt: null }
  const finished = { status: 'idle', doneAt: 1 }
  assert.deepEqual(donePlan([idle, running, archived, finished]), { done: true, targets: [idle] })
  assert.deepEqual(donePlan([finished, archived]), { done: false, targets: [finished] })
})
