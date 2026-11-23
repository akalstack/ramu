import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInbox, isLiveRecap, splitRecaps, startOfDay } from '../src/runtime/inbox.ts'

const NOW = new Date(2026, 9, 17, 15, 0, 0).getTime()
const DAY = 86_400_000
let n = 0
const chat = (over = {}) => ({
  id: `c${++n}`,
  taskId: `t${n}`,
  computerId: 'pc',
  status: 'idle',
  lastActiveAt: NOW - 1000,
  sessionId: `s${n}`,
  ...over,
})
const recap = (taskId, over = {}, computerId = 'pc') => ({
  computerId,
  item: {
    id: `r${++n}`,
    key: 'k',
    group: 'recent',
    title: 'x',
    detail: '',
    taskId,
    sessionId: 's',
    sourceSeq: 1,
    status: 'open',
    snoozedUntil: null,
    updatedAt: NOW - 1000,
    ...over,
  },
})
const summary = (over = {}, computerId = 'pc') => ({
  computerId,
  summary: { id: `m${++n}`, periodStart: 0, periodEnd: NOW, status: 'unread', items: [], ...over },
})
const build = (input) => buildInbox({ recaps: [], summaries: [], now: NOW, ...input })

test('snoozed recaps come back once the snooze has run out', () => {
  const item = recap('t').item
  assert.equal(isLiveRecap({ ...item, status: 'snoozed', snoozedUntil: NOW + 1 }, NOW), false)
  assert.equal(isLiveRecap({ ...item, status: 'snoozed', snoozedUntil: NOW }, NOW), true)
  assert.equal(isLiveRecap({ ...item, status: 'done' }, NOW), false)
  assert.equal(isLiveRecap({ ...item, status: 'dismissed' }, NOW), false)
})

test('recaps for threads that no longer exist are dropped, per host', () => {
  const chats = [{ taskId: 'a', computerId: 'pc' }]
  const out = splitRecaps([recap('a'), recap('gone'), recap('a', {}, 'other')], chats, 0, NOW)
  assert.equal(out.recent.length, 1)
})

test('recaps split into attention, since your last visit, and earlier, one recent recap per thread', () => {
  const chats = [
    { taskId: 'a', computerId: 'pc' },
    { taskId: 'b', computerId: 'pc' },
  ]
  const out = splitRecaps(
    [
      recap('a', { group: 'attention' }),
      recap('a', { updatedAt: NOW - 10 }),
      recap('a', { updatedAt: NOW - 20 }),
      recap('b', { updatedAt: NOW - 5 * DAY }),
    ],
    chats,
    NOW - DAY,
    NOW,
  )
  assert.equal(out.attention.length, 1)
  assert.equal(out.sinceVisit.length, 1)
  assert.equal(out.earlier.length, 1)
})

test('needs-you counts each thread once, holds recaps of threads already asking, and ignores archived and outbox threads', () => {
  const waiting = chat({ status: 'needs-input' })
  const model = build({
    chats: [
      waiting,
      chat({ status: 'needs-input', pending: true }),
      chat({ status: 'archived' }),
      chat({ status: 'running' }),
    ],
    recaps: [recap(waiting.taskId, { group: 'attention' })],
  })
  assert.equal(model.waiting.length, 1)
  assert.equal(model.running.length, 1)
  // The waiting thread's recap waits until the thread settles, so the thread counts once.
  assert.equal(model.attention.length, 0)
  assert.equal(model.needsYou, 1)
})

test('recaps are hidden for a host that turned them off', () => {
  const c = chat()
  const model = build({
    chats: [c],
    recaps: [recap(c.taskId, { group: 'attention' })],
    recapsEnabled: () => false,
  })
  assert.equal(model.attention.length, 0)
  assert.equal(model.needsYou, 0)
})

test('completed lists only finished threads from the last 7 days, grouped by day', () => {
  const today = startOfDay(NOW)
  const model = build({
    chats: [
      chat({ status: 'ready-for-review', lastActiveAt: today + 1000 }),
      chat({ status: 'idle', lastActiveAt: today - 1000 }),
      chat({ status: 'idle', lastActiveAt: today - 3 * DAY }),
      chat({ status: 'idle', lastActiveAt: today - 8 * DAY }),
      chat({ status: 'idle', sessionId: null }),
      chat({ status: 'failed' }),
    ],
  })
  // Failed threads count as finished too, so they are not lost between Needs you and Running.
  assert.equal(model.completed.length, 4)
  assert.deepEqual(
    model.days.map((d) => [d.label, d.items.length]),
    [
      ['today', 2],
      ['yesterday', 1],
      ['earlier', 1],
    ],
  )
})

test('learned hides dismissed summaries, counts unread and puts the newest first', () => {
  const model = build({
    chats: [],
    summaries: [
      summary({ periodEnd: 1, status: 'read' }),
      summary({ periodEnd: 3 }),
      summary({ periodEnd: 2, status: 'dismissed' }),
    ],
  })
  assert.deepEqual(
    model.summaries.map((s) => s.summary.periodEnd),
    [3, 1],
  )
  assert.equal(model.unreadSummaries, 1)
})

test('an inbox with nothing in it is empty', () => {
  assert.equal(build({ chats: [] }).empty, true)
  assert.equal(build({ chats: [chat({ status: 'running' })] }).empty, false)
})
