import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { nextOccurrence, previewOccurrences, ScheduleService, scheduleSchema } from '../src/background/schedules'
import { systemTimezone } from '@ramu/shared/workspace/timezone'
import { DEFAULT_AGENT_SETTINGS, NO_PROJECT, type ScheduleInput } from '@ramu/shared/types'
import { AgentService } from '../src/agent'
import { fakeQuery } from '../src/providers/fakeAgent'

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
    expect(
      nextOccurrence(
        { kind: 'weekly', time: '09:00', weekdays: [1, 2, 3, 4, 5] },
        'Asia/Jakarta',
        at('2026-10-09T02:00:00Z'),
      ),
    ).toBe(at('2026-10-12T02:00:00Z'))
  })
  it('skips months without the selected day', () => {
    expect(
      nextOccurrence({ kind: 'monthly', time: '09:00', day: 31 }, 'Asia/Jakarta', at('2026-01-31T02:00:00Z')),
    ).toBe(at('2026-03-31T02:00:00Z'))
  })
  it('shifts DST gaps forward and executes a repeated wall-clock time only once', () => {
    expect(nextOccurrence({ kind: 'daily', time: '02:30' }, 'America/New_York', at('2026-03-08T00:00:00Z'))).toBe(
      at('2026-03-08T07:30:00Z'),
    )
    expect(nextOccurrence({ kind: 'daily', time: '01:30' }, 'America/New_York', at('2026-11-01T00:00:00Z'))).toBe(
      at('2026-11-01T05:30:00Z'),
    )
    expect(nextOccurrence({ kind: 'daily', time: '01:30' }, 'America/New_York', at('2026-11-01T05:30:00Z'))).toBe(
      at('2026-11-02T06:30:00Z'),
    )
  })
  it('uses the persisted anchor rather than drifting with worker ticks', () => {
    expect(
      nextOccurrence(
        { kind: 'interval', minutes: 60, anchor: '2026-10-10T00:00:00Z' },
        'Asia/Jakarta',
        at('2026-10-10T02:19:00Z'),
      ),
    ).toBe(at('2026-10-10T03:00:00Z'))
  })
})
let db: Db, dir: string, ws: Workspace, service: ScheduleService
let state: string, blocked: boolean
// The run thread's goal, if any, and the messages waiting to be sent to it.
let goal: { status: string; reason: string; pausedBy?: string } | null, queuedMessages: unknown[]
// A run held at a usage limit, and whether the thread continues by itself.
let limited: boolean, autoResume: boolean
let start: ReturnType<typeof vi.fn>
// Told when a run gives up before any thread exists.
let startFailed: ReturnType<typeof vi.fn>
const input = (rule: ScheduleInput['rule']): ScheduleInput => ({
  name: 'Check',
  prompt: 'Review work',
  projectId: NO_PROJECT,
  timezone: 'Asia/Jakarta',
  rule,
  missedPolicy: 'latest',
  settings: DEFAULT_AGENT_SETTINGS,
})
beforeEach(() => {
  db = openDb(':memory:')
  dir = mkdtempSync(join(tmpdir(), 'ramu-schedules-'))
  ws = new Workspace(db, join(dir, 'worktrees'))
  state = 'running'
  blocked = false
  limited = false
  autoResume = true
  goal = null
  queuedMessages = []
  start = vi.fn(() => ({ id: 'session' }))
  startFailed = vi.fn()
  const agents = {
    validateSettings: async () => {},
    activeWriter: () => (blocked ? { id: 'other' } : null),
    startReviewed: start,
    isRecoveryPending: () => false,
    providerWait: () => (limited ? { retryAt: 1 } : null),
    autoResumeOf: () => autoResume,
    getGoal: () => goal,
    queued: () => queuedMessages,
    get: () => ({ id: 'session', state }),
  } as unknown as AgentService
  service = new ScheduleService(db, ws, agents, () => {}, startFailed as unknown as () => void)
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})
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
    const s = service.save(
      input({ kind: 'once', at: '2026-10-10T09:00:00+07:00' }),
      undefined,
      at('2026-10-09T00:00:00Z'),
    )
    await service.tick(at('2026-10-11T00:00:00Z'))
    expect(start).toHaveBeenCalledTimes(1)
    expect(service.get(s.id).state).toBe('completed')
    state = 'idle'
    await service.tick(at('2026-10-12T00:00:00Z'))
    expect(service.runs(s.id)[0]?.status).toBe('completed')
    expect(start).toHaveBeenCalledTimes(1)
  })
  it('keeps a run held at a usage limit running instead of completed, and completes it after it continues', async () => {
    const s = service.save(
      input({ kind: 'once', at: '2026-10-10T09:00:00+07:00' }),
      undefined,
      at('2026-10-09T00:00:00Z'),
    )
    await service.tick(at('2026-10-11T00:00:00Z'))
    // The thread is idle because it is waiting for the reset, not because it finished.
    state = 'idle'
    limited = true
    await service.tick(at('2026-10-12T00:00:00Z'))
    expect(service.runs(s.id)[0]?.status).toBe('running')
    limited = false
    await service.tick(at('2026-10-12T00:01:00Z'))
    expect(service.runs(s.id)[0]?.status).toBe('completed')
  })
  it('stops a run at its usage limit with the reason when auto-resume is off, and never marks it failed', async () => {
    const s = service.save(
      input({ kind: 'once', at: '2026-10-10T09:00:00+07:00' }),
      undefined,
      at('2026-10-09T00:00:00Z'),
    )
    await service.tick(at('2026-10-11T00:00:00Z'))
    state = 'idle'
    limited = true
    autoResume = false
    await service.tick(at('2026-10-12T00:00:00Z'))
    expect(service.runs(s.id)[0]).toMatchObject({
      status: 'interrupted',
      error: expect.stringContaining('Usage limit'),
    })
  })
  it('records a skipped missed occurrence without launching an agent', async () => {
    const s = service.save(
      { ...input({ kind: 'once', at: '2026-10-10T09:00:00+07:00' }), missedPolicy: 'skip' },
      undefined,
      at('2026-10-09T00:00:00Z'),
    )
    await service.tick(at('2026-10-11T00:00:00Z'))
    expect(start).not.toHaveBeenCalled()
    expect(service.runs(s.id)[0]?.status).toBe('missed')
  })
  it('defers a busy workspace and dispatches the same occurrence when it is free', async () => {
    const s = service.save(
      input({ kind: 'once', at: '2026-10-10T09:00:00+07:00' }),
      undefined,
      at('2026-10-09T00:00:00Z'),
    )
    blocked = true
    await service.tick(at('2026-10-10T02:00:00Z'))
    expect(start).not.toHaveBeenCalled()
    expect(service.runs(s.id)[0]?.status).toBe('queued')
    blocked = false
    await service.tick(at('2026-10-10T02:01:00Z'))
    expect(start).toHaveBeenCalledTimes(1)
    expect(service.runs(s.id)).toHaveLength(1)
  })
  it('does not replay an interrupted agent after service recovery', async () => {
    const s = service.save(
      input({ kind: 'once', at: '2026-10-10T09:00:00+07:00' }),
      undefined,
      at('2026-10-09T00:00:00Z'),
    )
    await service.tick(at('2026-10-10T02:00:00Z'))
    service.recover()
    await service.tick(at('2026-10-11T00:00:00Z'))
    expect(service.runs(s.id)[0]?.status).toBe('interrupted')
    expect(start).toHaveBeenCalledTimes(1)
  })
  it('continues the existing scheduled thread after restart without creating another occurrence', async () => {
    const original = new AgentService(db, () => {}, fakeQuery)
    vi.spyOn(original, 'validateSettings').mockResolvedValue()
    const originalSchedules = new ScheduleService(db, ws, original, () => {})
    const scheduled = originalSchedules.save(
      {
        ...input({ kind: 'once', at: '2026-10-10T09:00:00+07:00' }),
        settings: { ...DEFAULT_AGENT_SETTINGS, access: 'edits' },
      },
      undefined,
      at('2026-10-09T00:00:00Z'),
    )
    await originalSchedules.tick(at('2026-10-10T02:00:00Z'))
    const run = originalSchedules.runs(scheduled.id)[0]!
    const waitForInput = async (agents: AgentService) => {
      for (let i = 0; i < 100; i++) {
        if (agents.get(run.sessionId!).state === 'needs-input') return
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new Error('Expected pending approval')
    }
    await waitForInput(original)
    original.prepareForRestart()
    original.stopAll(true)
    const restored = new AgentService(db, () => {}, fakeQuery)
    restored.markRestoredOnBoot()
    const restoredSchedules = new ScheduleService(db, ws, restored, () => {})
    restoredSchedules.recover()
    await restoredSchedules.tick(at('2026-10-11T00:00:00Z'))
    expect(restoredSchedules.runs(scheduled.id)[0]?.status).toBe('running')
    await restored.resumeInterruptedChats()
    await waitForInput(restored)
    await restoredSchedules.tick(at('2026-10-11T00:00:00Z'))
    expect(restoredSchedules.runs(scheduled.id)).toHaveLength(1)
    expect(restoredSchedules.runs(scheduled.id)[0]).toMatchObject({
      id: run.id,
      sessionId: run.sessionId,
      taskId: run.taskId,
      status: 'needs-input',
    })
    expect(restored.events(run.sessionId!).filter((e) => e.kind === 'user')).toHaveLength(1)
    restored.stopAll()
  })
  it('bounds retries before an agent starts', async () => {
    start.mockImplementation(() => {
      throw new Error('Temporary startup failure')
    })
    const s = service.save(
      input({ kind: 'once', at: '2026-10-10T09:00:00+07:00' }),
      undefined,
      at('2026-10-09T00:00:00Z'),
    )
    await service.tick(at('2026-10-10T02:00:00Z'))
    await service.tick(at('2026-10-10T02:02:00Z'))
    await service.tick(at('2026-10-10T02:10:00Z'))
    expect(service.runs(s.id)[0]).toMatchObject({ attempts: 3, status: 'failed', retryAt: null })
  })
  it('tells the phone once, and only when the third start fails before any thread exists', async () => {
    start.mockImplementation(() => {
      throw new Error('Temporary startup failure')
    })
    const s = service.save(
      input({ kind: 'once', at: '2026-10-10T09:00:00+07:00' }),
      undefined,
      at('2026-10-09T00:00:00Z'),
    )
    await service.tick(at('2026-10-10T02:00:00Z'))
    await service.tick(at('2026-10-10T02:02:00Z'))
    expect(startFailed).not.toHaveBeenCalled()
    await service.tick(at('2026-10-10T02:10:00Z'))
    expect(startFailed).toHaveBeenCalledTimes(1)
    expect(startFailed.mock.calls[0]![0]).toMatchObject({ scheduleId: s.id, status: 'failed', attempts: 3 })
    await service.tick(at('2026-10-10T02:30:00Z'))
    expect(startFailed).toHaveBeenCalledTimes(1)
  })
  it('does not use the start-failure hook for a run whose thread failed later', async () => {
    service.save(input({ kind: 'once', at: '2026-10-10T09:00:00+07:00' }), undefined, at('2026-10-09T00:00:00Z'))
    await service.tick(at('2026-10-10T02:00:00Z'))
    state = 'failed'
    await service.tick(at('2026-10-10T02:05:00Z'))
    expect(startFailed).not.toHaveBeenCalled()
  })
})

const recordResult = (isError: boolean, text: string, seq = 1) => {
  const taskId = service.runs()[0]!.taskId!
  db.prepare(
    "INSERT OR IGNORE INTO agent_sessions(id,task_id,provider,cwd,state,created_at) VALUES ('session',?,'codex','/tmp','idle',1)",
  ).run(taskId)
  db.prepare('INSERT INTO agent_events VALUES (?, ?, ?)').run(
    'session',
    seq,
    JSON.stringify({ kind: 'result', isError, text, costUsd: null }),
  )
}
const onceRun = async () => {
  const s = service.save(
    input({ kind: 'once', at: '2026-10-10T09:00:00+07:00' }),
    undefined,
    at('2026-10-09T00:00:00Z'),
  )
  await service.tick(at('2026-10-11T00:00:00Z'))
  return s
}
describe('run outcomes', () => {
  it('records a failed thread with its last error, not as a finished run', async () => {
    const s = await onceRun()
    recordResult(true, 'Tests failed:\n  3 errors')
    state = 'failed'
    await service.tick(at('2026-10-12T00:00:00Z'))
    expect(service.runs(s.id)[0]).toMatchObject({ status: 'failed', error: 'Tests failed: 3 errors' })
  })
  it('does not read an idle thread whose last result was an error as a success', async () => {
    const s = await onceRun()
    recordResult(true, 'Provider returned an error')
    state = 'idle'
    await service.tick(at('2026-10-12T00:00:00Z'))
    expect(service.runs(s.id)[0]).toMatchObject({ status: 'failed', error: 'Provider returned an error' })
  })
  it('still succeeds when a later turn recovered, and when an idle thread has no error', async () => {
    const s = await onceRun()
    recordResult(true, 'Flaky first attempt', 1)
    recordResult(false, 'Done', 2)
    state = 'idle'
    await service.tick(at('2026-10-12T00:00:00Z'))
    expect(service.runs(s.id)[0]).toMatchObject({ status: 'completed', error: null })
  })
  it('records a stop by the user as cancelled, and a restart as interrupted', async () => {
    const s = await onceRun()
    state = 'stopped'
    await service.tick(at('2026-10-12T00:00:00Z'))
    expect(service.runs(s.id)[0]?.status).toBe('cancelled')
    db.prepare("UPDATE schedule_runs SET status='running'").run()
    state = 'restored'
    await service.tick(at('2026-10-12T00:00:00Z'))
    expect(service.runs(s.id)[0]?.status).toBe('interrupted')
  })
  it('keeps a run going while its goal continues or messages are queued', async () => {
    const s = await onceRun()
    state = 'idle'
    goal = { status: 'active', reason: '' }
    await service.tick(at('2026-10-12T00:00:00Z'))
    expect(service.runs(s.id)[0]?.status).toBe('running')
    goal = { status: 'waiting-provider', reason: '' }
    await service.tick(at('2026-10-12T00:00:00Z'))
    expect(service.runs(s.id)[0]?.status).toBe('running')
    // The merged shape of the same hold: paused by a usage limit still runs; paused by the user does not.
    goal = { status: 'paused', pausedBy: 'provider-limit', reason: '' }
    await service.tick(at('2026-10-12T00:00:00Z'))
    expect(service.runs(s.id)[0]?.status).toBe('running')
    goal = null
    queuedMessages = [{ id: 'm' }]
    await service.tick(at('2026-10-12T00:00:00Z'))
    expect(service.runs(s.id)[0]?.status).toBe('running')
    queuedMessages = []
    await service.tick(at('2026-10-12T00:00:00Z'))
    expect(service.runs(s.id)[0]?.status).toBe('completed')
  })
  it('does not keep a run going for a goal the user paused', async () => {
    const s = await onceRun()
    state = 'idle'
    goal = { status: 'paused', pausedBy: 'user', reason: '' }
    await service.tick(at('2026-10-12T00:00:00Z'))
    expect(service.runs(s.id)[0]?.status).toBe('completed')
  })
  it('records a blocked or out-of-turns goal as needing input, with the reason', async () => {
    const s = await onceRun()
    state = 'idle'
    goal = { status: 'blocked', reason: 'Need the production API token' }
    await service.tick(at('2026-10-12T00:00:00Z'))
    expect(service.runs(s.id)[0]).toMatchObject({ status: 'needs-input', error: 'Need the production API token' })
    goal = { status: 'completed', reason: 'Evidence' }
    await service.tick(at('2026-10-12T00:00:00Z'))
    expect(service.runs(s.id)[0]?.status).toBe('completed')
  })
  it('does not treat the error result of a usage limit as a failure', async () => {
    const s = await onceRun()
    recordResult(true, 'usage_limit_reached')
    state = 'idle'
    limited = true
    await service.tick(at('2026-10-12T00:00:00Z'))
    expect(service.runs(s.id)[0]?.status).toBe('running')
    autoResume = false
    await service.tick(at('2026-10-12T00:00:00Z'))
    expect(service.runs(s.id)[0]).toMatchObject({
      status: 'interrupted',
      error: expect.stringContaining('Usage limit'),
    })
  })
})
describe('repeated failure', () => {
  const hourly = () =>
    service.save(
      input({ kind: 'interval', minutes: 60, anchor: '2026-10-10T00:00:00Z' }),
      undefined,
      at('2026-10-09T00:00:00Z'),
    )
  const runAt = async (hour: number, ending: string) => {
    state = ending
    await service.tick(at('2026-10-10T00:00:00Z') + hour * 3600_000)
  }
  it('pauses the schedule after three failed runs in a row and keeps the reason', async () => {
    const s = hourly()
    await runAt(1, 'failed')
    recordResult(true, 'Build is broken')
    await runAt(2, 'failed')
    expect(service.get(s.id).state).toBe('active')
    await runAt(3, 'failed')
    expect(service.get(s.id)).toMatchObject({
      state: 'paused',
      pausedReason: expect.stringMatching(/Paused after 3 failed runs in a row\..*Build is broken/),
    })
    await runAt(4, 'failed')
    expect(start).toHaveBeenCalledTimes(3)
  })
  it('does not pause when a success or an unfinished run breaks the streak', async () => {
    const s = hourly()
    await runAt(1, 'failed')
    await runAt(2, 'idle')
    await runAt(3, 'failed')
    await runAt(4, 'stopped')
    await runAt(5, 'failed')
    expect(service.get(s.id).state).toBe('active')
    expect(
      service
        .runs(s.id)
        .sort((a, b) => a.dueAt - b.dueAt)
        .map((r) => r.status),
    ).toEqual(['failed', 'completed', 'failed', 'cancelled', 'failed'])
  })
  it('counts again from zero after a resume, and drops the reason', async () => {
    const s = hourly()
    for (const hour of [1, 2, 3]) await runAt(hour, 'failed')
    expect(service.get(s.id).state).toBe('paused')
    service.pause(s.id, false)
    expect(service.get(s.id)).toMatchObject({ state: 'active' })
    expect(service.get(s.id).pausedReason).toBeUndefined()
    // After the resume the schedule is due again from now on.
    const later = async (hour: number) => {
      state = 'failed'
      await service.tick(Date.now() + hour * 3600_000)
    }
    await later(1)
    await later(2)
    expect(service.get(s.id).state).toBe('active')
    await later(3)
    expect(service.get(s.id).state).toBe('paused')
  })
  it('keeps a pause reason through an edit while paused, and pauses when startup keeps failing', async () => {
    start.mockImplementation(() => {
      throw new Error('Cannot start')
    })
    const s = hourly()
    for (const hour of [1, 2, 3]) {
      const base = at('2026-10-10T00:00:00Z') + hour * 3600_000
      await service.tick(base)
      await service.tick(base + 2 * 60_000)
      await service.tick(base + 10 * 60_000)
    }
    expect(service.get(s.id)).toMatchObject({ state: 'paused', pausedReason: expect.stringContaining('Cannot start') })
    const reason = service.get(s.id).pausedReason
    service.save({ ...input({ kind: 'interval', minutes: 60, anchor: '2026-10-10T00:00:00Z' }), name: 'Renamed' }, s.id)
    expect(service.get(s.id)).toMatchObject({ state: 'paused', name: 'Renamed', pausedReason: reason })
  })
})
