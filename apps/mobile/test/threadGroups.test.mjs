import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupKey, groupThreads, splitDone } from '../src/runtime/threadGroups.ts'

const thread = (id, projectId, lastActiveAt, status = 'idle', computerId = 'a') => ({
  id,
  computerId,
  projectId,
  status,
  lastActiveAt,
})
const none = { limit: 3, expanded: new Set(), collapsed: new Set() }

test('home groups threads by project, newest first, then empty projects, with standalone threads at the bottom', () => {
  const projects = [
    { id: 'a:quiet', computerId: 'a' },
    { id: 'a:old', computerId: 'a' },
    { id: 'a:new', computerId: 'a' },
  ]
  const groups = groupThreads(
    [thread('o', 'a:old', 1), thread('n', 'a:new', 5), thread('s', 'standalone', 9)],
    projects,
    none,
  )
  assert.deepEqual(
    groups.map((group) => [group.projectId, group.threads.map((x) => x.id)]),
    [
      ['a:new', ['n']],
      ['a:old', ['o']],
      ['a:quiet', []],
      ['standalone', ['s']],
    ],
  )
  assert.equal(groups[3].project, undefined)
  assert.equal(groups[0].project, projects[2])
})

test('a capped group keeps every running, waiting or failed thread and reports what is hidden', () => {
  const list = [
    ...Array.from({ length: 6 }, (_, i) => thread(`h${i}`, 'a:p', 100 - i)),
    thread('wait', 'a:p', 10, 'needs-input'),
    thread('run', 'a:p', 9, 'running'),
    thread('fail', 'a:p', 8, 'failed'),
  ]
  const [group] = groupThreads(list, [{ id: 'a:p', computerId: 'a' }], none)
  assert.deepEqual(
    group.threads.map((x) => x.id),
    ['h0', 'h1', 'h2', 'wait', 'run', 'fail'],
  )
  assert.equal(group.total, 9)
  assert.equal(group.hidden, 3)
  assert.equal(group.running, 1)
  assert.equal(group.attention, 2)

  const key = groupKey('a', 'a:p')
  const open = groupThreads(list, [], { ...none, expanded: new Set([key]) })[0]
  assert.equal(open.threads.length, 9)
  assert.equal(open.hidden, 0)
  // Collapsed shows nothing, but the counts still tell the header that work needs attention.
  const closed = groupThreads(list, [], { ...none, collapsed: new Set([key]) })[0]
  assert.deepEqual(closed.threads, [])
  assert.equal(closed.attention, 2)
})

test('standalone threads and colliding project IDs stay separate per host', () => {
  const groups = groupThreads(
    [thread('a1', 'standalone', 2, 'idle', 'a'), thread('b1', 'standalone', 1, 'idle', 'b')],
    [],
    none,
  )
  assert.deepEqual(
    groups.map((group) => [group.computerId, group.threads.map((x) => x.id)]),
    [
      ['a', ['a1']],
      ['b', ['b1']],
    ],
  )
  assert.notEqual(groups[0].key, groups[1].key)
})

test('threads marked done leave their projects for one Done list, most recently finished first', () => {
  const { open, done } = splitDone([
    { id: 'a', doneAt: null },
    { id: 'b', doneAt: 10 },
    { id: 'c', doneAt: 30 },
    { id: 'd' },
  ])
  assert.deepEqual(
    open.map((thread) => thread.id),
    ['a', 'd'],
  )
  assert.deepEqual(
    done.map((thread) => thread.id),
    ['c', 'b'],
  )
})
