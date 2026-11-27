import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInbox, startOfDay } from '../src/runtime/inbox.ts'

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
const summary = (over = {}, computerId = 'pc') => ({
  computerId,
  summary: { id: `m${++n}`, periodStart: 0, periodEnd: NOW, status: 'unread', items: [], ...over },
})
const build = (input) => buildInbox({ summaries: [], now: NOW, ...input })

test('needs-you counts each waiting thread once and ignores archived and outbox threads', () => {
  const model = build({
    chats: [
      chat({ status: 'needs-input' }),
      chat({ status: 'needs-input', pending: true }),
      chat({ status: 'archived' }),
      chat({ status: 'running' }),
    ],
  })
  assert.equal(model.waiting.length, 1)
  assert.equal(model.running.length, 1)
  assert.equal(model.needsYou, 1)
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
