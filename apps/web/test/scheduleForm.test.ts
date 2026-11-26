import { DateTime } from 'luxon'
import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, NO_PROJECT, type Schedule } from '@ramu/shared/types'
import {
  RULE_KINDS,
  byNextRun,
  canSaveSchedule,
  defaultScheduleInput,
  describeRule,
  isProblemRun,
  onceIso,
  onceLocalValue,
  presetOf,
  ruleForKind,
  setWeekday,
  splitList,
  webhookRule,
} from '../src/scheduleForm'
import { WEBHOOK_PRESETS } from '@ramu/shared/webhooks'

const zone = 'Asia/Jakarta' // UTC+7, no daylight saving
const now = DateTime.fromISO('2026-10-18T10:00:00', { zone })

describe('new schedule defaults', () => {
  it('starts daily at nine in the open thread project, or in no project', () => {
    const input = defaultScheduleInput(DEFAULT_AGENT_SETTINGS, zone, 'p1')
    expect(input).toMatchObject({
      projectId: 'p1',
      timezone: zone,
      rule: { kind: 'daily', time: '09:00' },
      missedPolicy: 'latest',
    })
    expect(input.name).toBe('')
    expect(defaultScheduleInput(DEFAULT_AGENT_SETTINGS, zone, null).projectId).toBe(NO_PROJECT)
  })
})

describe('one-time schedules', () => {
  it('shows the schedule time in its own zone, or an hour from now for a new one', () => {
    expect(onceLocalValue({ kind: 'once', at: '2026-10-20T02:30:00.000Z' }, zone, now)).toBe('2026-10-20T09:30')
    expect(onceLocalValue(undefined, zone, now)).toBe('2026-10-18T11:00')
    expect(onceLocalValue({ kind: 'daily', time: '09:00' }, zone, now)).toBe('2026-10-18T11:00')
  })
  it('reads the picked wall-clock time in the schedule zone and keeps unparsable text', () => {
    expect(onceIso('2026-10-20T09:30', zone)).toBe('2026-10-20T09:30:00.000+07:00')
    expect(onceIso('not a date', zone)).toBe('not a date')
  })
})

describe('changing the frequency', () => {
  it('offers every frequency', () => {
    expect([...RULE_KINDS].sort()).toEqual(['daily', 'interval', 'monthly', 'once', 'webhook', 'weekly'])
  })
  it('builds a sensible starting rule for each kind', () => {
    expect(ruleForKind('daily', '', zone, now)).toEqual({ kind: 'daily', time: '09:00' })
    expect(ruleForKind('weekly', '', zone, now)).toEqual({ kind: 'weekly', time: '09:00', weekdays: [1, 2, 3, 4, 5] })
    expect(ruleForKind('monthly', '', zone, now)).toEqual({ kind: 'monthly', time: '09:00', day: 1 })
    expect(ruleForKind('once', '2026-10-20T09:30', zone, now)).toEqual({
      kind: 'once',
      at: '2026-10-20T09:30:00.000+07:00',
    })
    const interval = ruleForKind('interval', '', zone, now)
    expect(interval).toMatchObject({ kind: 'interval', minutes: 60 })
    expect(DateTime.fromISO((interval as { anchor: string }).anchor).toMillis()).toBe(now.plus({ hours: 1 }).toMillis())
  })
})

describe('weekdays', () => {
  it('adds and removes days in week order without duplicates', () => {
    expect(setWeekday([1, 3], 2, true)).toEqual([1, 2, 3])
    expect(setWeekday([1, 2, 3], 2, true)).toEqual([1, 2, 3])
    expect(setWeekday([1, 2, 3], 2, false)).toEqual([1, 3])
    expect(setWeekday([1], 1, false)).toEqual([])
  })
})

describe('saving', () => {
  const ready = { busy: false, previewLoading: false, preview: [1], name: 'Morning check', prompt: 'Review the repo' }
  it('needs a name, a prompt and a valid upcoming run', () => {
    expect(canSaveSchedule(ready)).toBe(true)
    expect(canSaveSchedule({ ...ready, name: '  ' })).toBe(false)
    expect(canSaveSchedule({ ...ready, prompt: '' })).toBe(false)
    expect(canSaveSchedule({ ...ready, preview: [] })).toBe(false)
  })
  it('waits while saving or while the preview loads', () => {
    expect(canSaveSchedule({ ...ready, busy: true })).toBe(false)
    expect(canSaveSchedule({ ...ready, previewLoading: true })).toBe(false)
  })
})

describe('the schedule list', () => {
  const entry = (id: string, nextRunAt: number | null) => ({ id, nextRunAt }) as Schedule
  it('lists the soonest run first and schedules with nothing upcoming last, without changing the input', () => {
    const input = [entry('late', 30), entry('none', null), entry('soon', 10)]
    expect(byNextRun(input).map((s) => s.id)).toEqual(['soon', 'late', 'none'])
    expect(input.map((s) => s.id)).toEqual(['late', 'none', 'soon'])
  })
  it('marks failed and interrupted runs as problems', () => {
    expect(isProblemRun('failed')).toBe(true)
    expect(isProblemRun('interrupted')).toBe(true)
    expect(isProblemRun('completed')).toBe(false)
    expect(isProblemRun('missed')).toBe(false)
  })
})

describe('webhook schedules', () => {
  it('start from the first preset, signed the way its sender signs', () => {
    const rule = ruleForKind('webhook', '', zone, now)
    expect(rule).toMatchObject({ kind: 'webhook', source: 'github', signature: { header: 'x-hub-signature-256' } })
    expect(presetOf(rule as ReturnType<typeof webhookRule>)?.id).toBe(WEBHOOK_PRESETS[0]!.id)
  })
  it('stop naming a preset once its filters change', () => {
    const rule = webhookRule(WEBHOOK_PRESETS[0]!)
    expect(presetOf({ ...rule, filters: [] })).toBeNull()
  })
  it('save without an upcoming time, and read a typed list', () => {
    const form = { busy: false, previewLoading: false, preview: [], name: 'Fix CI', prompt: 'Fix it' }
    expect(canSaveSchedule(form)).toBe(false)
    expect(canSaveSchedule({ ...form, webhook: true })).toBe(true)
    expect(splitList(' opened, ,reopened ')).toEqual(['opened', 'reopened'])
  })
})

describe('describeRule', () => {
  // Translation left out: the keys are the English copy, with their values filled in.
  const say = (text: string, values: Record<string, string | number> = {}) =>
    text.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key]))
  const day = (n: number) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][n - 1]!
  const line = (rule: Parameters<typeof describeRule>[0]) => describeRule(rule, say, day)

  it('names the days a weekly schedule runs', () => {
    expect(line({ kind: 'weekly', time: '08:30', weekdays: [5, 1, 2, 3, 4] })).toBe('Weekdays at 08:30')
    expect(line({ kind: 'weekly', time: '10:00', weekdays: [6, 7] })).toBe('Weekends at 10:00')
    expect(line({ kind: 'weekly', time: '09:00', weekdays: [3, 1, 1] })).toBe('Mon, Wed at 09:00')
    expect(line({ kind: 'weekly', time: '07:00', weekdays: [1, 2, 3, 4, 5, 6, 7] })).toBe('Every day at 07:00')
  })

  it('reads an interval in its largest whole unit', () => {
    const anchor = '2026-11-01T00:00:00+07:00'
    expect(line({ kind: 'interval', minutes: 45, anchor })).toBe('Every 45 minutes')
    expect(line({ kind: 'interval', minutes: 60, anchor })).toBe('Every hour')
    expect(line({ kind: 'interval', minutes: 240, anchor })).toBe('Every 4 hours')
    expect(line({ kind: 'interval', minutes: 2880, anchor })).toBe('Every 2 days')
    expect(line({ kind: 'interval', minutes: 10080, anchor })).toBe('Every week')
  })

  it('describes the other kinds', () => {
    expect(line({ kind: 'daily', time: '01:00' })).toBe('Every day at 01:00')
    expect(line({ kind: 'monthly', time: '09:00', day: 1 })).toBe('Day 1 of each month at 09:00')
    expect(line({ kind: 'once', at: '2026-12-01T10:00:00+07:00' })).toBe('Once')
    const preset = (source: string) => webhookRule(WEBHOOK_PRESETS.find((entry) => entry.source === source)!)
    expect(line(preset('github'))).toBe('When GitHub sends a request')
    expect(line(preset('generic'))).toBe('When a request arrives')
  })
})
