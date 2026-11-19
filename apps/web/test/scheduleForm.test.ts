import { DateTime } from 'luxon'
import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, NO_PROJECT, type Schedule } from '@ramu/shared/types'
import {
  RULE_KINDS,
  byNextRun,
  canSaveSchedule,
  defaultScheduleInput,
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
