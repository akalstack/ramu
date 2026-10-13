import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace'
import { nextOccurrence, previewOccurrences, ScheduleService, scheduleSchema } from '../src/schedules'
import { systemTimezone } from '@ramu/shared/timezone'
import { DEFAULT_AGENT_SETTINGS, NO_PROJECT, type ScheduleInput } from '@ramu/shared/types'
import { AgentService } from '../src/agent'
import { fakeQuery } from '../src/fakeAgent'

const at = (s: string) => Date.parse(s)
describe('timezone-aware recurrence', () => {
  it('defaults a new schedule to the OS timezone and preserves an explicit existing zone', () => {
    const value = input({ kind: 'daily', time: '09:00' })
    const { timezone: _timezone, ...withoutZone } = value
    expect(scheduleSchema.parse(withoutZone).timezone).toBe(systemTimezone())
    expect(scheduleSchema.parse(value).timezone).toBe('Asia/Jakarta')
  })
  it('executes a one-time timestamp once', () => {
    const rule = { kind: 'once' as const, at: '2026-10-11T09:00:00+07:00' }
    expect(previewOccurrences(rule, 'Asia/Jakarta', at('2026-10-10T00:00:00Z'))).toEqual([at('2026-10-11T02:00:00Z')])
    expect(nextOccurrence(rule, 'Asia/Jakarta', at(rule.at))).toBeNull()
  })
  it('keeps weekday wall-clock time and skips weekends', () => {
    expect(nextOccurrence({ kind: 'weekly', time: '09:00', weekdays: [1, 2, 3, 4, 5] }, 'Asia/Jakarta', at('2026-10-09T02:00:00Z'))).toBe(at('2026-10-12T02:00:00Z'))
  })
  it('skips months without the selected day', () => {
    expect(nextOccurrence({ kind: 'monthly', time: '09:00', day: 31 }, 'Asia/Jakarta', at('2026-01-31T02:00:00Z'))).toBe(at('2026-03-31T02:00:00Z'))
  })
  it('shifts DST gaps forward and executes a repeated wall-clock time only once', () => {
    expect(nextOccurrence({ kind: 'daily', time: '02:30' }, 'America/New_York', at('2026-03-08T00:00:00Z'))).toBe(at('2026-03-08T07:30:00Z'))
    expect(nextOccurrence({ kind: 'daily', time: '01:30' }, 'America/New_York', at('2026-11-01T00:00:00Z'))).toBe(at('2026-11-01T05:30:00Z'))
    expect(nextOccurrence({ kind: 'daily', time: '01:30' }, 'America/New_York', at('2026-11-01T05:30:00Z'))).toBe(at('2026-11-02T06:30:00Z'))
  })
  it('uses the persisted anchor rather than drifting with worker ticks', () => {
    expect(nextOccurrence({ kind: 'interval', minutes: 60, anchor: '2026-10-10T00:00:00Z' }, 'Asia/Jakarta', at('2026-10-10T02:19:00Z'))).toBe(at('2026-10-10T03:00:00Z'))
  })
})
let db: Db, dir: string, ws: Workspace, service: ScheduleService
let state: string, blocked: boolean
let start: ReturnType<typeof vi.fn>
const input = (rule: ScheduleInput['rule']): ScheduleInput => ({ name: 'Check', prompt: 'Review work', projectId: NO_PROJECT, timezone: 'Asia/Jakarta', rule, missedPolicy: 'latest', settings: DEFAULT_AGENT_SETTINGS })
beforeEach(() => {
  db = openDb(':memory:'); dir = mkdtempSync(join(tmpdir(), 'ramu-schedules-')); ws = new Workspace(db, join(dir, 'worktrees'))
  state = 'running'; blocked = false
  start = vi.fn(() => ({ id: 'session' }))
  const agents = { validateSettings: async () => {}, activeWriter: () => blocked ? { id: 'other' } : null, startReviewed: start, isRecoveryPending: () => false, get: () => ({ state }) } as unknown as AgentService
  service = new ScheduleService(db, ws, agents, () => {})
})
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })
describe('durable dispatch', () => {
  it('coalesces missed daily runs and prevents duplicate dispatch', async () => {
    const s = service.save(input({ kind: 'daily', time: '09:00' }), undefined, at('2026-10-01T00:00:00Z'))
    await Promise.all([service.tick(at('2026-10-10T03:00:00Z')), service.tick(at('2026-10-10T03:00:00Z'))])
    expect(start).toHaveBeenCalledTimes(1)
    expect(service.runs(s.id)).toHaveLength(1)
    expect(service.runs(s.id)[0]?.dueAt).toBe(at('2026-10-10T02:00:00Z'))
    expect(service.get(s.id).nextRunAt).toBe(at('2026-10-11T02:00:00Z'))
  })
  it('catches up a one-time run and completes its schedule permanently', async () => {
    const s = service.save(input({ kind: 'once', at: '2026-10-10T09:00:00+07:00' }), undefined, at('2026-10-09T00:00:00Z'))
    await service.tick(at('2026-10-11T00:00:00Z'))
    expect(start).toHaveBeenCalledTimes(1); expect(service.get(s.id).state).toBe('completed')
    state = 'idle'; await service.tick(at('2026-10-12T00:00:00Z'))
    expect(service.runs(s.id)[0]?.status).toBe('completed'); expect(start).toHaveBeenCalledTimes(1)
  })
  it('records a skipped missed occurrence without launching an agent', async () => {
    const s = service.save({ ...input({ kind: 'once', at: '2026-10-10T09:00:00+07:00' }), missedPolicy: 'skip' }, undefined, at('2026-10-09T00:00:00Z'))
    await service.tick(at('2026-10-11T00:00:00Z'))
    expect(start).not.toHaveBeenCalled(); expect(service.runs(s.id)[0]?.status).toBe('missed')
  })
  it('defers a busy workspace and dispatches the same occurrence when it is free', async () => {
    const s = service.save(input({ kind: 'once', at: '2026-10-10T09:00:00+07:00' }), undefined, at('2026-10-09T00:00:00Z'))
    blocked = true; await service.tick(at('2026-10-10T02:00:00Z'))
    expect(start).not.toHaveBeenCalled(); expect(service.runs(s.id)[0]?.status).toBe('queued')
    blocked = false; await service.tick(at('2026-10-10T02:01:00Z'))
    expect(start).toHaveBeenCalledTimes(1); expect(service.runs(s.id)).toHaveLength(1)
  })
  it('does not replay an interrupted agent after service recovery', async () => {
    const s = service.save(input({ kind: 'once', at: '2026-10-10T09:00:00+07:00' }), undefined, at('2026-10-09T00:00:00Z'))
    await service.tick(at('2026-10-10T02:00:00Z')); service.recover(); await service.tick(at('2026-10-11T00:00:00Z'))
    expect(service.runs(s.id)[0]?.status).toBe('interrupted'); expect(start).toHaveBeenCalledTimes(1)
  })
  it('continues the existing scheduled chat after restart without creating another occurrence', async () => {
    const original = new AgentService(db, () => {}, fakeQuery)
    vi.spyOn(original, 'validateSettings').mockResolvedValue()
    const originalSchedules = new ScheduleService(db, ws, original, () => {})
    const scheduled = originalSchedules.save({ ...input({ kind: 'once', at: '2026-10-10T09:00:00+07:00' }), settings: { ...DEFAULT_AGENT_SETTINGS, access: 'edits' } }, undefined, at('2026-10-09T00:00:00Z'))
    await originalSchedules.tick(at('2026-10-10T02:00:00Z'))
    const run = originalSchedules.runs(scheduled.id)[0]!
    const waitForInput = async (agents: AgentService) => {
      for (let i = 0; i < 100; i++) { if (agents.get(run.sessionId!).state === 'needs-input') return; await new Promise((resolve) => setTimeout(resolve, 10)) }
      throw new Error('Expected pending approval')
    }
    await waitForInput(original)
    original.prepareForRestart(); original.stopAll(true)
    const restored = new AgentService(db, () => {}, fakeQuery)
    restored.markRestoredOnBoot()
    const restoredSchedules = new ScheduleService(db, ws, restored, () => {})
    restoredSchedules.recover()
    await restoredSchedules.tick(at('2026-10-11T00:00:00Z'))
    expect(restoredSchedules.runs(scheduled.id)[0]?.status).toBe('running')
    await restored.resumeInterruptedChats(); await waitForInput(restored)
    await restoredSchedules.tick(at('2026-10-11T00:00:00Z'))
    expect(restoredSchedules.runs(scheduled.id)).toHaveLength(1)
    expect(restoredSchedules.runs(scheduled.id)[0]).toMatchObject({ id: run.id, sessionId: run.sessionId, taskId: run.taskId, status: 'needs-input' })
    expect(restored.events(run.sessionId!).filter((e) => e.kind === 'user')).toHaveLength(1)
    restored.stopAll()
  })
  it('bounds retries before an agent starts', async () => {
    start.mockImplementation(() => { throw new Error('Temporary startup failure') })
    const s = service.save(input({ kind: 'once', at: '2026-10-10T09:00:00+07:00' }), undefined, at('2026-10-09T00:00:00Z'))
    await service.tick(at('2026-10-10T02:00:00Z')); await service.tick(at('2026-10-10T02:02:00Z')); await service.tick(at('2026-10-10T02:10:00Z'))
    expect(service.runs(s.id)[0]).toMatchObject({ attempts: 3, status: 'failed', retryAt: null })
  })
})
