import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  groupKey,
  groupKeys,
  groupThreads,
  moveProject,
  readThreadList,
  splitDone,
} from '../src/runtime/threadGroups.ts'
import { resolveLayered } from '../src/runtime/busyMode.ts'

const thread = (id, projectId, lastActiveAt, status = 'idle', computerId = 'a') => ({
  id,
  computerId,
  projectId,
  status,
  lastActiveAt,
})
const none = { limit: 3, expanded: new Set(), collapsed: new Set() }

test('home groups threads by project in the host’s own order, whatever is newest, with standalone threads at the bottom', () => {
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
      ['a:quiet', []],
      ['a:old', ['o']],
      ['a:new', ['n']],
      ['standalone', ['s']],
    ],
  )
  assert.equal(groups[3].project, undefined)
  assert.equal(groups[2].project, projects[2])
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

test("the thread list follows this phone, then all your phones, then the host's Sidebar shows", () => {
  const mode = (device, mobile, all) =>
    resolveLayered(
      { device: readThreadList(device), mobile: readThreadList(mobile), all: readThreadList(all) },
      'projects',
    ).value
  assert.equal(mode(undefined, undefined, true), 'recent')
  assert.equal(mode(undefined, false, true), 'projects')
  assert.equal(mode('recent', false, false), 'recent')
  // A cleared phone choice is stored as '' and falls through to the host.
  assert.equal(mode('', undefined, true), 'recent')
  assert.equal(mode(undefined, 'yes', undefined), 'projects')
})

test('a project moves one place in its host’s order, and not past either end', () => {
  assert.deepEqual(moveProject(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c'])
  assert.deepEqual(moveProject(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b'])
  assert.equal(moveProject(['a', 'b', 'c'], 'a', -1), null)
  assert.equal(moveProject(['a', 'b', 'c'], 'c', 1), null)
  assert.equal(moveProject(['a', 'b'], 'gone', 1), null)
})

test('one repository on two hosts is one group, led by the host it was last worked on', () => {
  const projects = [
    { id: 'a:ramu', computerId: 'a', repository: 'github.com/akalstack/ramu' },
    { id: 'a:local', computerId: 'a' },
    { id: 'b:ramu', computerId: 'b', repository: 'github.com/akalstack/ramu' },
  ]
  const threads = [
    thread('old', 'a:ramu', 1, 'idle', 'a'),
    thread('new', 'b:ramu', 5, 'idle', 'b'),
    thread('mine', 'a:local', 3, 'idle', 'a'),
  ]
  const merged = groupThreads(threads, projects, { ...none, mergeHosts: true })
  assert.deepEqual(
    merged.map((group) => [group.computerId, group.threads.map((x) => x.id), group.members?.length ?? 1]),
    [
      // Newest first inside the group, and its menu and New thread go to the host worked on last.
      ['b', ['new', 'old'], 2],
      // A project with no remote stays its own, under its host.
      ['a', ['mine'], 1],
    ],
  )
  // Separate by host: the same repository is one group per host.
  assert.equal(groupThreads(threads, projects, none).length, 3)
})

test('a thread’s group key is its repository’s when hosts merge, so its folded runs open with the merged group', () => {
  const projects = [
    { id: 'a:ramu', computerId: 'a', repository: 'github.com/akalstack/ramu' },
    { id: 'b:ramu', computerId: 'b', repository: 'github.com/akalstack/ramu' },
    { id: 'a:local', computerId: 'a' },
  ]
  const merged = groupKeys(projects, true)
  assert.equal(merged('a', 'a:ramu'), merged('b', 'b:ramu'))
  assert.equal(merged('a', 'a:local'), groupKey('a', 'a:local'))
  // Separate by host, and a project the list does not know, keep the host's own key.
  assert.equal(groupKeys(projects, false)('b', 'b:ramu'), groupKey('b', 'b:ramu'))
  assert.equal(merged('c', 'gone'), groupKey('c', 'gone'))
  const [group] = groupThreads([thread('t', 'b:ramu', 1, 'idle', 'b')], projects, { ...none, mergeHosts: true })
  assert.equal(group.key, merged('b', 'b:ramu'))
})
