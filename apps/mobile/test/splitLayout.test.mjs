import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LIST_PANE_WIDTH, SPLIT_MIN_WIDTH, paneThreads, showsSplit } from '../src/runtime/splitLayout.ts'

test('only windows wide enough for a list and a readable thread split', () => {
  assert.equal(showsSplit(430, 932), false) // a large phone
  assert.equal(showsSplit(932, 430), false) // the same phone on its side
  assert.equal(showsSplit(834, 1194), false) // an 11-inch iPad in portrait
  assert.equal(showsSplit(1032, 1376), true) // a 13-inch iPad in portrait
  assert.equal(showsSplit(1194, 834), true) // an 11-inch iPad in landscape
  assert.equal(showsSplit(1280, 800), true) // an Android tablet in landscape
  assert.equal(showsSplit(Number.NaN, 800), false)
  assert.ok(SPLIT_MIN_WIDTH - LIST_PANE_WIDTH >= 520, 'the thread keeps a phone-and-a-half of width')
})

const thread = (id, extra = {}) => ({ id, status: 'idle', lastActiveAt: 0, pinnedAt: null, doneAt: null, ...extra })

test('pinned threads lead, the rest follow by latest activity, done and archived stay out', () => {
  const list = paneThreads(
    [
      thread('old', { lastActiveAt: 1 }),
      thread('new', { lastActiveAt: 5 }),
      thread('pin', { pinnedAt: 3 }),
      thread('done', { lastActiveAt: 9, doneAt: 9 }),
      thread('gone', { lastActiveAt: 9, status: 'archived' }),
    ],
    'new',
    20,
  )
  assert.deepEqual(
    list.pinned.map((t) => t.id),
    ['pin'],
  )
  assert.deepEqual(
    list.recent.map((t) => t.id),
    ['new', 'old'],
  )
  assert.equal(list.more, false)
})

test('the open thread stays listed past the limit or when it is done', () => {
  const threads = [thread('a', { lastActiveAt: 3 }), thread('b', { lastActiveAt: 2 }), thread('c', { lastActiveAt: 1 })]
  const list = paneThreads(threads, 'c', 1)
  assert.deepEqual(
    list.recent.map((t) => t.id),
    ['a', 'c'],
  )
  assert.equal(list.more, true)
  const done = paneThreads([...threads, thread('d', { doneAt: 1 })], 'd', 5)
  assert.ok(done.recent.some((t) => t.id === 'd'))
})
