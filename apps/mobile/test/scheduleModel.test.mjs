import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultInput,
  describeRule,
  intervalText,
  onceInstant,
  parseTime,
  ruleOfKind,
  runsOf,
  shiftTime,
  sortSchedules,
  toggleWeekday,
  validateInput,
} from '../src/runtime/scheduleModel.ts'

const settings = { provider: 'claude-code', model: '', effort: null, access: 'full', autoFallback: true }
const valid = () => ({ ...defaultInput(settings), name: 'Check', prompt: 'Look around' })

test('times are normalised and bad ones rejected', () => {
  assert.equal(parseTime('9'), '09:00')
  assert.equal(parseTime('930'), '09:30')
  assert.equal(parseTime('9:05'), '09:05')
  assert.equal(parseTime('24:00'), null)
  assert.equal(parseTime('12:60'), null)
  assert.equal(parseTime('abc'), null)
})

test('shifting a time wraps around midnight both ways', () => {
  assert.equal(shiftTime('23:50', 20), '00:10')
  assert.equal(shiftTime('00:05', -10), '23:55')
  assert.equal(shiftTime('09:00', 30), '09:30')
})

test('rules read as one line', () => {
  assert.equal(describeRule({ kind: 'daily', time: '09:00' }), 'Every day at 09:00')
  assert.equal(describeRule({ kind: 'weekly', time: '08:30', weekdays: [1, 2, 3, 4, 5] }), 'Weekdays at 08:30')
  assert.equal(describeRule({ kind: 'weekly', time: '10:00', weekdays: [7, 6] }), 'Weekends at 10:00')
  assert.equal(describeRule({ kind: 'weekly', time: '10:00', weekdays: [1, 3] }), 'Mon, Wed at 10:00')
  assert.equal(describeRule({ kind: 'monthly', time: '07:00', day: 15 }), 'Day 15 of each month at 07:00')
  assert.equal(describeRule({ kind: 'interval', minutes: 120, anchor: '2026-01-01T00:00:00Z' }), 'Every 2 hours')
  assert.equal(describeRule({ kind: 'daily', time: '09:00' }, 'id'), 'Setiap hari pukul 09:00')
})

test('intervals use the largest whole unit', () => {
  assert.equal(intervalText(60), 'hour')
  assert.equal(intervalText(90), '90 minutes')
  assert.equal(intervalText(1440), 'day')
  assert.equal(intervalText(20160), '2 weeks')
})

test('weekday toggling keeps the list sorted and never empties it', () => {
  assert.deepEqual(toggleWeekday([1, 5], 3), [1, 3, 5])
  assert.deepEqual(toggleWeekday([1, 3, 5], 3), [1, 5])
  assert.deepEqual(toggleWeekday([2], 2), [2])
})

test('switching the rule kind keeps the time of day', () => {
  const next = ruleOfKind('weekly', { kind: 'daily', time: '06:45' })
  assert.deepEqual(next, { kind: 'weekly', time: '06:45', weekdays: [1, 2, 3, 4, 5] })
  const same = { kind: 'daily', time: '01:00' }
  assert.equal(ruleOfKind('daily', same), same)
  assert.equal(ruleOfKind('once', same).kind, 'once')
})

test('a once-rule is an ISO instant with an explicit offset', () => {
  const at = onceInstant(new Date(2026, 9, 18), '14:30')
  assert.match(at, /Z$|[+-]\d\d:\d\d$/)
  const d = new Date(at)
  assert.equal(d.getHours(), 14)
  assert.equal(d.getMinutes(), 30)
})

test('the form reports what is missing before it is sent', () => {
  const now = Date.UTC(2026, 9, 17)
  assert.equal(validateInput(valid(), now), null)
  assert.match(validateInput({ ...valid(), name: '  ' }, now), /name/)
  assert.match(validateInput({ ...valid(), prompt: '' }, now), /agent should do/)
  assert.match(validateInput({ ...valid(), rule: { kind: 'daily', time: '25:00' } }, now), /valid time/)
  assert.match(validateInput({ ...valid(), rule: { kind: 'weekly', time: '09:00', weekdays: [] } }, now), /weekday/)
  assert.match(
    validateInput({ ...valid(), rule: { kind: 'monthly', time: '09:00', day: 32 } }, now),
    /between 1 and 31/,
  )
  assert.match(
    validateInput({ ...valid(), rule: { kind: 'interval', minutes: 2, anchor: '2026-01-01T00:00:00Z' } }, now),
    /5 minutes/,
  )
  assert.match(validateInput({ ...valid(), rule: { kind: 'once', at: '2026-01-01T00:00:00Z' } }, now), /future/)
  assert.equal(validateInput({ ...valid(), rule: { kind: 'once', at: '2027-01-01T00:00:00Z' } }, now), null)
})

test('active schedules sort by next run, then paused, then completed', () => {
  const s = (name, state, nextRunAt) => ({ ...valid(), id: name, name, state, nextRunAt, createdAt: 0 })
  const out = sortSchedules([
    s('c', 'completed', null),
    s('p', 'paused', 5),
    s('late', 'active', 20),
    s('soon', 'active', 10),
  ])
  assert.deepEqual(
    out.map((x) => x.id),
    ['soon', 'late', 'p', 'c'],
  )
})

test('runs of one schedule list newest first', () => {
  const runs = [
    { id: 'a', scheduleId: 's', dueAt: 1 },
    { id: 'b', scheduleId: 'x', dueAt: 9 },
    { id: 'c', scheduleId: 's', dueAt: 3 },
  ]
  assert.deepEqual(
    runsOf(runs, 's').map((r) => r.id),
    ['c', 'a'],
  )
})

test('schedule writes require an online non-viewer host while older hosts retain server-authorized actions', async () => {
  const { scheduleWriteProblem, VIEW_ONLY_SCHEDULE_NOTICE } = await import('../src/runtime/scheduleModel.ts')
  assert.equal(scheduleWriteProblem({ status: 'online', access: 'owner' }, 'en'), null)
  assert.equal(scheduleWriteProblem({ status: 'online' }, 'en'), null)
  assert.equal(scheduleWriteProblem({ status: 'online', access: 'viewer' }, 'en'), VIEW_ONLY_SCHEDULE_NOTICE.en)
  assert.equal(scheduleWriteProblem({ status: 'offline', access: 'viewer' }, 'id'), VIEW_ONLY_SCHEDULE_NOTICE.id)
  assert.match(scheduleWriteProblem(undefined, 'en'), /Connect/)
  assert.match(scheduleWriteProblem({ status: 'offline', access: 'owner' }, 'id'), /Hubungkan/)
})
